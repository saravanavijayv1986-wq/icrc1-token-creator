import { api } from "encore.dev/api";
import { tokenDB } from "./db";
import { storage } from "./storage";
import { icp } from "~encore/clients";
import { validate } from "../common/validation";
import { handleError, ErrorCode, AppError } from "../common/errors";
import { tokenCreationLimiter } from "../common/rate-limiter";
import { metrics, monitor } from "../common/monitoring";
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
  monitor("token.create", async (req) => {
    try {
      // Rate limiting (SQL-backed)
      await tokenCreationLimiter.checkLimit(req.creatorPrincipal);

      // Input validation (zod + custom principal check)
      const parsed = createSchema.safeParse(req);
      if (!parsed.success) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          "Invalid input parameters",
          { errors: parsed.error.errors.map(e => e.message) }
        );
      }

      const validator = validate()
        .required(req.creatorPrincipal, "creatorPrincipal")
        .principal(req.creatorPrincipal, "creatorPrincipal");

      if (req.decimals !== undefined) {
        validator.number(req.decimals, "decimals", { min: 0, max: 18, integer: true });
      }

      if (!validator.isValid()) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          "Invalid input parameters",
          { errors: validator.getErrors() }
        );
      }

      const decimals = req.decimals ?? 8;
      const creatorPrincipal = req.creatorPrincipal;

      // Check for duplicate symbol
      const existingToken = await tokenDB.queryRow`
        SELECT id FROM tokens WHERE UPPER(symbol) = UPPER(${req.symbol})
      `;
      
      if (existingToken) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Token with symbol ${req.symbol} already exists`
        );
      }

      // Validate delegation identity
      if (!req.delegationIdentity) {
        throw new AppError(
          ErrorCode.INVALID_DELEGATION,
          "Valid delegation identity is required for ICP deployment"
        );
      }

      let logoUrl: string | null = null;

      // Upload logo if provided
      if (req.logoFile) {
        try {
          // strict base64 validation already in zod; decode
          const buffer = Buffer.from(req.logoFile, "base64");

          // Validate file size (max 2MB)
          if (buffer.length > 2 * 1024 * 1024) {
            throw new AppError(
              ErrorCode.VALIDATION_ERROR,
              "Logo file size must be less than 2MB"
            );
          }

          // Sniff type and restrict
          const contentType = detectImageType(buffer);
          if (contentType === "unknown") {
            throw new AppError(
              ErrorCode.VALIDATION_ERROR,
              "Unsupported image format. Allowed: PNG, JPEG, WebP"
            );
          }

          // Basic checksum for caching validation
          const sha256 = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16);

          const fileName = `token-logos/${req.symbol.toLowerCase()}-${Date.now()}-${sha256}.png`;
          await storage.upload(fileName, buffer, {
            contentType
          });
          logoUrl = storage.publicUrl(fileName);
          
          log.info("Logo uploaded successfully", { fileName, size: buffer.length });
        } catch (error) {
          log.error("Logo upload failed", { error: error instanceof Error ? error.message : "Unknown" });
          throw new AppError(
            ErrorCode.EXTERNAL_SERVICE_ERROR,
            "Failed to upload logo",
            {}
          );
        }
      }

      // Create token record with transaction
      const tokenRow = await tokenDB.queryRow<{ id: number }>`
        INSERT INTO tokens (
          token_name, symbol, total_supply, decimals, logo_url,
          creator_principal, is_mintable, is_burnable, status, created_at
        ) VALUES (
          ${req.tokenName.trim()}, 
          ${req.symbol.trim().toUpperCase()}, 
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
        throw new AppError(
          ErrorCode.EXTERNAL_SERVICE_ERROR,
          "Failed to create token record in database"
        );
      }

      log.info("Token record created", { 
        tokenId: tokenRow.id, 
        symbol: req.symbol, 
        creator: "[REDACTED]" 
      });

      try {
        // Deploy canister using the ICP service with real delegation
        const deployResult = await icp.deploy({
          tokenName: req.tokenName.trim(),
          symbol: req.symbol.trim().toUpperCase(),
          totalSupply: req.totalSupply,
          decimals,
          logoUrl: logoUrl ?? undefined,
          isMintable: req.isMintable ?? false,
          isBurnable: req.isBurnable ?? false,
          delegationIdentity: req.delegationIdentity,
          ownerPrincipal: creatorPrincipal,
        });

        // Update token with canister ID
        await tokenDB.exec`
          UPDATE tokens 
          SET 
            canister_id = ${deployResult.canisterId}, 
            status = ${deployResult.status},
            updated_at = NOW()
          WHERE id = ${tokenRow.id}
        `;

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

        // Record metrics
        metrics.increment("token.created");

        log.info("Token deployment successful", { 
          tokenId: tokenRow.id,
          canisterId: deployResult.canisterId,
          symbol: req.symbol
        });

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
        
        log.error("ICP deployment failed", { 
          tokenId: tokenRow.id, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
        
        throw new AppError(
          ErrorCode.TOKEN_DEPLOYMENT_FAILED,
          "Failed to deploy canister to Internet Computer",
          { tokenId: tokenRow.id }
        );
      }
    } catch (error) {
      return handleError(error as Error, "token.create");
    }
  })
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
  monitor("token.sync", async (req) => {
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
        throw new AppError(ErrorCode.RESOURCE_NOT_FOUND, "Token not found");
      }

      if (!token.canister_id) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, "Token has no canister ID");
      }

      if (token.status !== 'deployed') {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR, 
          `Token is not deployed. Current status: ${token.status}`
        );
      }

      // Get current token info from the canister
      const tokenInfo = await icp.getTokenInfo({ canisterId: token.canister_id });

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
      
      log.info("Token synced with canister", { 
        tokenId: req.tokenId, 
        symbol: token.symbol,
        canisterId: token.canister_id
      });

      return {
        success: true,
        updatedFields: ['name', 'symbol', 'decimals', 'totalSupply', 'metadata']
      };
    } catch (error) {
      metrics.increment("token.sync_failed");
      return handleError(error as Error, "token.syncWithCanister");
    }
  })
);
