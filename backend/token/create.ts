import { api, APIError } from "encore.dev/api";
import { tokenDB } from "./db";
import { storage } from "./storage";
import { icp } from "~encore/clients";
import { validate } from "../common/validation";
import { handleError, ErrorCode, AppError } from "../common/errors";
import { tokenCreationLimiter } from "../common/rate-limiter";
import { metrics, monitor } from "../common/monitoring";
import log from "encore.dev/log";

export interface CreateTokenRequest {
  tokenName: string;
  symbol: string;
  totalSupply: number;
  decimals?: number;
  logoFile?: string; // base64 encoded image
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

// Creates a new ICRC-1 token and deploys it to the IC.
export const create = api<CreateTokenRequest, CreateTokenResponse>(
  { expose: true, method: "POST", path: "/tokens" },
  monitor("token.create")(async (req) => {
    try {
      // Rate limiting
      await tokenCreationLimiter.checkLimit(req.creatorPrincipal);

      // Input validation
      const validator = validate()
        .required(req.tokenName, "tokenName")
        .string(req.tokenName, "tokenName", { minLength: 2, maxLength: 50 })
        .required(req.symbol, "symbol")
        .string(req.symbol, "symbol", { 
          minLength: 2, 
          maxLength: 10,
          pattern: /^[A-Z0-9]+$/ 
        })
        .required(req.totalSupply, "totalSupply")
        .number(req.totalSupply, "totalSupply", { min: 1, max: 1000000000000, integer: true })
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
          // Validate base64 image
          if (!req.logoFile.match(/^[A-Za-z0-9+/]+=*$/)) {
            throw new AppError(
              ErrorCode.VALIDATION_ERROR,
              "Invalid logo file format"
            );
          }

          const buffer = Buffer.from(req.logoFile, 'base64');
          
          // Validate file size (max 2MB)
          if (buffer.length > 2 * 1024 * 1024) {
            throw new AppError(
              ErrorCode.VALIDATION_ERROR,
              "Logo file size must be less than 2MB"
            );
          }

          const fileName = `token-logos/${req.symbol.toLowerCase()}-${Date.now()}.png`;
          await storage.upload(fileName, buffer, {
            contentType: 'image/png'
          });
          logoUrl = storage.publicUrl(fileName);
          
          log.info("Logo uploaded successfully", { fileName, size: buffer.length });
        } catch (error) {
          log.error("Logo upload failed", { error });
          throw new AppError(
            ErrorCode.EXTERNAL_SERVICE_ERROR,
            "Failed to upload logo",
            { originalError: error instanceof Error ? error.message : 'Unknown error' }
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
        creator: creatorPrincipal 
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

        // Log creation transaction with comprehensive metadata
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
            ${JSON.stringify(metadata)},
            NOW()
          )
        `;

        // Record metrics
        metrics.increment("token.created", { 
          status: "success",
          mintable: String(req.isMintable ?? false),
          burnable: String(req.isBurnable ?? false)
        });

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
        
        metrics.increment("token.created", { status: "failed" });
        
        log.error("ICP deployment failed", { 
          tokenId: tokenRow.id, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
        
        throw new AppError(
          ErrorCode.TOKEN_DEPLOYMENT_FAILED,
          "Failed to deploy canister to Internet Computer",
          { 
            tokenId: tokenRow.id,
            originalError: error instanceof Error ? error.message : 'Unknown error'
          }
        );
      }
    } catch (error) {
      return handleError(error, "token.create");
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
  monitor("token.sync")(async (req) => {
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
          metadata = ${JSON.stringify({ 
            transferFee: tokenInfo.transferFee,
            metadata: tokenInfo.metadata,
            lastSync: new Date().toISOString()
          })},
          updated_at = NOW()
        WHERE id = ${req.tokenId}
      `;

      metrics.increment("token.synced", { status: "success" });
      
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
      metrics.increment("token.synced", { status: "failed" });
      return handleError(error, "token.syncWithCanister");
    }
  })
);
