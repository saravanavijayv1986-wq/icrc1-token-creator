import { api } from "encore.dev/api";
import { tokenDB } from "./db";
import { storage } from "./storage";
import { icp } from "~encore/clients";
import { validate } from "../common/validation";
import { handleError, ErrorCode, AppError, createAppError } from "../common/errors";
import { tokenCreationLimiter } from "../common/rate-limiter";
import { metrics, monitor } from "../common/monitoring";
import { initializeMonitoring } from "../monitoring/monitoring_api";
import { logger, OperationType, withOperationLogging } from "../common/logger";
import { addBreadcrumb, setTag } from "../common/sentry";
import log from "encore.dev/log";
import crypto from "node:crypto";
import { z } from "zod";

export interface CreateTokenRequest {
  tokenName: string;
  symbol: string;
  totalSupply: number;
  decimals?: number;
  logoFile?: string; // base64 encoded image (data only, no prefix)
  isMintable?: boolean;
  isBurnable?: boolean;
  creatorPrincipal: string;
  delegationIdentity: any; // Delegation chain from Internet Identity
}

export interface CreateTokenResponse {
  tokenId: number;
  canisterId: string;
  transactionId: string;
  deploymentStatus: string;
  estimatedTime: string;
  cyclesUsed: string;
}

// Simple image type sniff: PNG/JPEG/WebP magic numbers
function detectImageType(buf: Buffer): "image/png" | "image/jpeg" | "image/webp" | "unknown" {
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.slice(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (buf.slice(0, 4).equals(Buffer.from([0x52, 0x49, 0x46, 0x46])) && buf.slice(8, 12).equals(Buffer.from([0x57, 0x45, 0x42, 0x50]))) return "image/webp";
  return "unknown";
}

const createSchema = z.object({
  tokenName: z.string().min(2).max(50),
  symbol: z.string().regex(/^[A-Z0-9]+$/).min(2).max(10),
  totalSupply: z.number().int().positive().max(1_000_000_000_000),
  decimals: z.number().int().min(0).max(18).optional(),
  logoFile: z.string().base64().optional(),
  isMintable: z.boolean().optional(),
  isBurnable: z.boolean().optional(),
  creatorPrincipal: z.string().min(1),
  delegationIdentity: z.any(),
});

// Creates a new ICRC-1 token and deploys it to the IC.
export const create = api<CreateTokenRequest, CreateTokenResponse>(
  { expose: true, method: "POST", path: "/tokens" },
  withOperationLogging(
    OperationType.TOKEN_CREATION,
    "Create ICRC-1 Token",
    monitor("token.create", async (req) => {
      const operationId = logger.startOperation(
        OperationType.TOKEN_CREATION,
        "Token creation initiated",
        {
          metadata: {
            symbol: req.symbol,
            tokenName: req.tokenName,
            totalSupply: req.totalSupply,
            decimals: req.decimals,
            isMintable: req.isMintable,
            isBurnable: req.isBurnable,
          }
        }
      );

      // Set Sentry tags for this operation
      setTag("operation_type", "token_creation");
      setTag("token_symbol", req.symbol);

      try {
        // Add breadcrumb for token creation start
        addBreadcrumb(
          "Token creation started",
          "token",
          "info",
          {
            symbol: req.symbol,
            totalSupply: req.totalSupply,
            operationId,
          }
        );

        // Rate limiting (SQL-backed)
        await tokenCreationLimiter.checkLimit(req.creatorPrincipal);
        
        logger.info("Rate limit check passed", {
          operationType: OperationType.TOKEN_CREATION,
          operationId,
          metadata: { principal: req.creatorPrincipal }
        });

        // Input validation (zod + custom principal check)
        const parsed = createSchema.safeParse(req);
        if (!parsed.success) {
          throw createAppError(
            ErrorCode.VALIDATION_ERROR,
            "Invalid input parameters",
            { errors: parsed.error.errors.map(e => e.message) },
            OperationType.TOKEN_CREATION,
            operationId
          );
        }

        const validator = validate()
          .required(req.creatorPrincipal, "creatorPrincipal")
          .principal(req.creatorPrincipal, "creatorPrincipal");

        if (req.decimals !== undefined) {
          validator.number(req.decimals, "decimals", { min: 0, max: 18, integer: true });
        }

        if (!validator.isValid()) {
          throw createAppError(
            ErrorCode.VALIDATION_ERROR,
            "Invalid input parameters",
            { errors: validator.getErrors() },
            OperationType.TOKEN_CREATION,
            operationId
          );
        }

        const decimals = req.decimals ?? 8;
        const creatorPrincipal = req.creatorPrincipal;
        const symbol = req.symbol.trim().toUpperCase();

        logger.info("Input validation passed", {
          operationType: OperationType.TOKEN_CREATION,
          operationId,
          metadata: { decimals, symbol }
        });

        // Check for duplicate symbol
        const existingToken = await tokenDB.queryRow`
          SELECT id FROM tokens WHERE symbol = ${symbol}
        `;
        
        if (existingToken) {
          throw createAppError(
            ErrorCode.VALIDATION_ERROR,
            `Token with symbol '${symbol}' already exists`,
            { symbol: req.symbol },
            OperationType.TOKEN_CREATION,
            operationId
          );
        }

        logger.info("Symbol uniqueness verified", {
          operationType: OperationType.TOKEN_CREATION,
          operationId,
          metadata: { symbol }
        });

        // Validate delegation identity
        if (!req.delegationIdentity) {
          throw createAppError(
            ErrorCode.INVALID_DELEGATION,
            "Valid delegation identity is required for ICP deployment",
            undefined,
            OperationType.TOKEN_CREATION,
            operationId
          );
        }

        let logoUrl: string | null = null;

        // Upload logo if provided
        if (req.logoFile) {
          try {
            logger.info("Processing logo upload", {
              operationType: OperationType.TOKEN_CREATION,
              operationId,
              metadata: { hasLogo: true }
            });

            // strict base64 validation already in zod; decode
            const buffer = Buffer.from(req.logoFile, "base64");

            // Validate file size (max 2MB)
            if (buffer.length > 2 * 1024 * 1024) {
              throw createAppError(
                ErrorCode.VALIDATION_ERROR,
                "Logo file size must be less than 2MB",
                { fileSize: buffer.length },
                OperationType.TOKEN_CREATION,
                operationId
              );
            }

            // Sniff type and restrict
            const contentType = detectImageType(buffer);
            if (contentType === "unknown") {
              throw createAppError(
                ErrorCode.VALIDATION_ERROR,
                "Unsupported image format. Allowed: PNG, JPEG, WebP",
                { detectedType: contentType },
                OperationType.TOKEN_CREATION,
                operationId
              );
            }

            // Basic checksum for caching validation
            const sha256 = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16);

            const fileName = `token-logos/${symbol.toLowerCase()}-${Date.now()}-${sha256}.png`;
            await storage.upload(fileName, buffer, {
              contentType
            });
            logoUrl = storage.publicUrl(fileName);
            
            logger.info("Logo upload successful", {
              operationType: OperationType.TOKEN_CREATION,
              operationId,
              metadata: { fileName, fileSize: buffer.length, contentType }
            });

            addBreadcrumb(
              "Logo uploaded successfully",
              "token",
              "info",
              { fileName, fileSize: buffer.length }
            );
          } catch (error) {
            logger.error("Logo upload failed", error instanceof Error ? error : new Error(String(error)), {
              operationType: OperationType.TOKEN_CREATION,
              operationId,
            });
            
            throw createAppError(
              ErrorCode.EXTERNAL_SERVICE_ERROR,
              "Failed to upload logo",
              {},
              OperationType.TOKEN_CREATION,
              operationId
            );
          }
        }

        // Create token record with transaction
        logger.info("Creating token database record", {
          operationType: OperationType.TOKEN_CREATION,
          operationId,
          metadata: { symbol, hasLogo: !!logoUrl }
        });

        const tokenRow = await tokenDB.queryRow<{ id: number }>`
          INSERT INTO tokens (
            token_name, symbol, total_supply, decimals, logo_url,
            creator_principal, is_mintable, is_burnable, status, created_at
          ) VALUES (
            ${req.tokenName.trim()}, 
            ${symbol}, 
            ${req.totalSupply}, 
            ${decimals}, 
            ${logoUrl},
            ${creatorPrincipal}, 
            ${req.isMintable ?? false}, 
            ${req.isBurnable ?? false}, 
            'deploying',
            NOW()
          )
          RETURNING id
        `;

        if (!tokenRow) {
          throw createAppError(
            ErrorCode.EXTERNAL_SERVICE_ERROR,
            "Failed to create token record in database",
            undefined,
            OperationType.TOKEN_CREATION,
            operationId
          );
        }

        logger.info("Token database record created", {
          operationType: OperationType.TOKEN_CREATION,
          operationId,
          tokenId: tokenRow.id,
          metadata: { symbol }
        });

        addBreadcrumb(
          "Token record created in database",
          "database",
          "info",
          { tokenId: tokenRow.id, symbol }
        );

        try {
          // Deploy canister using the ICP service with real delegation
          logger.info("Starting canister deployment", {
            operationType: OperationType.CANISTER_DEPLOY,
            operationId,
            tokenId: tokenRow.id,
            metadata: { symbol }
          });

          const deployResult = await icp.deploy({
            tokenName: req.tokenName.trim(),
            symbol: symbol,
            totalSupply: req.totalSupply,
            decimals,
            logoUrl: logoUrl ?? undefined,
            isMintable: req.isMintable ?? false,
            isBurnable: req.isBurnable ?? false,
            delegationIdentity: req.delegationIdentity,
            ownerPrincipal: creatorPrincipal,
          });

          logger.info("Canister deployment successful", {
            operationType: OperationType.CANISTER_DEPLOY,
            operationId,
            tokenId: tokenRow.id,
            canisterId: deployResult.canisterId,
            metadata: {
              symbol: symbol,
              cyclesUsed: deployResult.cyclesUsed,
              status: deployResult.status
            }
          });

          addBreadcrumb(
            "Canister deployed successfully",
            "blockchain",
            "info",
            { 
              canisterId: deployResult.canisterId,
              cyclesUsed: deployResult.cyclesUsed,
              status: deployResult.status
            }
          );

          // Update token with canister ID
          await tokenDB.exec`
            UPDATE tokens 
            SET 
              canister_id = ${deployResult.canisterId}, 
              status = ${deployResult.status},
              updated_at = NOW()
            WHERE id = ${tokenRow.id}
          `;

          logger.info("Token record updated with canister ID", {
            operationType: OperationType.TOKEN_CREATION,
            operationId,
            tokenId: tokenRow.id,
            canisterId: deployResult.canisterId
          });

          // Initialize monitoring for the new canister
          await initializeMonitoring(tokenRow.id, deployResult.canisterId);

          logger.info("Monitoring initialized", {
            operationType: OperationType.TOKEN_CREATION,
            operationId,
            tokenId: tokenRow.id,
            canisterId: deployResult.canisterId
          });

          // Log creation transaction with structured metadata
          const transactionId = deployResult.deploymentHash;
          const metadata = {
            cyclesUsed: deployResult.cyclesUsed,
            canisterId: deployResult.canisterId,
            deploymentTimestamp: new Date().toISOString(),
            icpNetwork: "mainnet",
            tokenStandard: "ICRC-1",
            features: {
              mintable: req.isMintable ?? false,
              burnable: req.isBurnable ?? false
            }
          };

          await tokenDB.exec`
            INSERT INTO token_transactions (
              token_id, transaction_type, to_principal, amount, fee_paid, tx_hash, metadata, created_at
            ) VALUES (
              ${tokenRow.id}, 
              'creation', 
              ${creatorPrincipal}, 
              ${req.totalSupply}, 
              1.0, 
              ${transactionId},
              ${metadata},
              NOW()
            )
          `;

          logger.info("Creation transaction logged", {
            operationType: OperationType.TOKEN_CREATION,
            operationId,
            tokenId: tokenRow.id,
            metadata: { transactionId }
          });

          // Record metrics
          metrics.increment("token.created");

          logger.completeOperation(
            operationId,
            OperationType.TOKEN_CREATION,
            "Token creation completed successfully",
            true,
            undefined,
            {
              tokenId: tokenRow.id,
              canisterId: deployResult.canisterId,
              symbol: symbol
            }
          );

          addBreadcrumb(
            "Token creation completed successfully",
            "token",
            "info",
            {
              tokenId: tokenRow.id,
              canisterId: deployResult.canisterId,
              symbol: symbol
            }
          );

          return {
            tokenId: tokenRow.id,
            canisterId: deployResult.canisterId,
            transactionId,
            deploymentStatus: deployResult.status,
            estimatedTime: '2-3 minutes',
            cyclesUsed: deployResult.cyclesUsed,
          };
        } catch (error) {
          // Update token status to failed
          await tokenDB.exec`
            UPDATE tokens 
            SET status = 'failed', updated_at = NOW(), failure_reason = ${error instanceof Error ? error.message : 'Unknown error'}
            WHERE id = ${tokenRow.id}
          `;
          
          metrics.increment("token.create_failed");
          
          logger.error("ICP deployment failed", error instanceof Error ? error : new Error(String(error)), {
            operationType: OperationType.TOKEN_CREATION,
            operationId,
            tokenId: tokenRow.id,
          });

          addBreadcrumb(
            "Token deployment failed",
            "blockchain",
            "error",
            { tokenId: tokenRow.id, error: error instanceof Error ? error.message : String(error) }
          );
          
          throw createAppError(
            ErrorCode.TOKEN_DEPLOYMENT_FAILED,
            "Failed to deploy canister to Internet Computer",
            { tokenId: tokenRow.id },
            OperationType.TOKEN_CREATION,
            operationId
          );
        }
      } catch (error) {
        logger.completeOperation(
          operationId,
          OperationType.TOKEN_CREATION,
          "Token creation failed",
          false,
          undefined,
          {
            errorMessage: error instanceof Error ? error.message : String(error)
          }
        );

        return handleError(error as Error, "token.create", OperationType.TOKEN_CREATION, operationId);
      }
    })
  )
);

export interface SyncTokenRequest {
  tokenId: number;
}

export interface SyncTokenResponse {
  success: boolean;
  updatedFields: string[];
}

// Syncs token data with the deployed canister on ICP.
export const syncWithCanister = api<SyncTokenRequest, SyncTokenResponse>(
  { expose: true, method: "POST", path: "/tokens/:tokenId/sync" },
  withOperationLogging(
    OperationType.TOKEN_CREATION,
    "Sync Token with Canister",
    monitor("token.sync", async (req) => {
      const operationId = logger.startOperation(
        OperationType.TOKEN_CREATION,
        "Token sync initiated",
        {
          tokenId: req.tokenId
        }
      );

      try {
        // Input validation
        validate()
          .required(req.tokenId, "tokenId")
          .number(req.tokenId, "tokenId", { min: 1, integer: true })
          .throwIfInvalid();

        // Get token from database
        const token = await tokenDB.queryRow<{
          id: number;
          canister_id: string;
          status: string;
          symbol: string;
        }>`
          SELECT id, canister_id, status, symbol
          FROM tokens 
          WHERE id = ${req.tokenId}
        `;

        if (!token) {
          throw createAppError(
            ErrorCode.RESOURCE_NOT_FOUND, 
            "Token not found",
            { tokenId: req.tokenId },
            OperationType.TOKEN_CREATION,
            operationId
          );
        }

        if (!token.canister_id) {
          throw createAppError(
            ErrorCode.VALIDATION_ERROR, 
            "Token has no canister ID",
            { tokenId: req.tokenId },
            OperationType.TOKEN_CREATION,
            operationId
          );
        }

        if (token.status !== 'deployed') {
          throw createAppError(
            ErrorCode.VALIDATION_ERROR,
            `Token is not deployed. Current status: ${token.status}`,
            { tokenId: req.tokenId, status: token.status },
            OperationType.TOKEN_CREATION,
            operationId
          );
        }

        logger.info("Starting canister sync", {
          operationType: OperationType.TOKEN_CREATION,
          operationId,
          tokenId: req.tokenId,
          canisterId: token.canister_id,
          metadata: { symbol: token.symbol }
        });

        // Get current token info from the canister
        const tokenInfo = await icp.getTokenInfo({ canisterId: token.canister_id });

        logger.info("Retrieved token info from canister", {
          operationType: OperationType.TOKEN_CREATION,
          operationId,
          tokenId: req.tokenId,
          metadata: {
            name: tokenInfo.name,
            symbol: tokenInfo.symbol,
            totalSupply: tokenInfo.totalSupply
          }
        });

        // Update database with canister data
        await tokenDB.exec`
          UPDATE tokens 
          SET 
            token_name = ${tokenInfo.name},
            symbol = ${tokenInfo.symbol},
            decimals = ${tokenInfo.decimals},
            total_supply = ${BigInt(tokenInfo.totalSupply)},
            metadata = ${{
              transferFee: tokenInfo.transferFee,
              metadata: tokenInfo.metadata,
              lastSync: new Date().toISOString()
            }},
            updated_at = NOW()
          WHERE id = ${req.tokenId}
        `;

        metrics.increment("token.synced");
        
        logger.completeOperation(
          operationId,
          OperationType.TOKEN_CREATION,
          "Token sync completed successfully",
          true,
          undefined,
          {
            tokenId: req.tokenId,
            canisterId: token.canister_id,
            symbol: token.symbol
          }
        );

        addBreadcrumb(
          "Token synced with canister",
          "blockchain",
          "info",
          {
            tokenId: req.tokenId,
            canisterId: token.canister_id,
            symbol: token.symbol
          }
        );

        return {
          success: true,
          updatedFields: ['name', 'symbol', 'decimals', 'totalSupply', 'metadata']
        };
      } catch (error) {
        metrics.increment("token.sync_failed");
        
        logger.completeOperation(
          operationId,
          OperationType.TOKEN_CREATION,
          "Token sync failed",
          false,
          undefined,
          {
            tokenId: req.tokenId,
            errorMessage: error instanceof Error ? error.message : String(error)
          }
        );

        return handleError(error as Error, "token.syncWithCanister", OperationType.TOKEN_CREATION, operationId);
      }
    })
  )
);
