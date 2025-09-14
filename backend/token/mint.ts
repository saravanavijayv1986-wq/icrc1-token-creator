import { api } from "encore.dev/api";
import { tokenDB } from "./db";
import { icp } from "~encore/clients";
import { tokenOperationLimiter } from "../common/rate-limiter";
import { handleError, createAppError, ErrorCode } from "../common/errors";
import { logger, OperationType, withOperationLogging } from "../common/logger";
import { addBreadcrumb, setTag } from "../common/sentry";

export interface MintTokenRequest {
  tokenId: number;
  amount: number;
  toPrincipal: string;
  creatorPrincipal: string;
  delegationIdentity: any; // Delegation chain for authentication
}

export interface MintTokenResponse {
  success: boolean;
  transactionId: string;
  blockIndex: string;
  newTotalSupply: string;
  newBalance: string;
}

// Mints additional tokens for a mintable token using ICP canister.
export const mint = api<MintTokenRequest, MintTokenResponse>(
  { expose: true, method: "POST", path: "/tokens/:tokenId/mint" },
  withOperationLogging(
    OperationType.TOKEN_MINT,
    "Mint Tokens",
    async (req) => {
      const operationId = logger.startOperation(
        OperationType.TOKEN_MINT,
        "Token mint initiated",
        {
          tokenId: req.tokenId,
          amount: req.amount.toString(),
          metadata: {
            toPrincipal: req.toPrincipal,
          }
        }
      );

      // Set Sentry tags for this operation
      setTag("operation_type", "token_mint");
      setTag("token_id", req.tokenId.toString());

      try {
        // Add breadcrumb for mint start
        addBreadcrumb(
          "Token mint started",
          "token",
          "info",
          {
            tokenId: req.tokenId,
            amount: req.amount,
            operationId,
          }
        );

        // Rate limit mint operations per creator
        await tokenOperationLimiter.checkLimit(req.creatorPrincipal);

        logger.info("Rate limit check passed for mint operation", {
          operationType: OperationType.TOKEN_MINT,
          operationId,
          tokenId: req.tokenId,
          metadata: { amount: req.amount }
        });

        const creatorPrincipal = req.creatorPrincipal;

        // Verify token exists and is mintable
        const token = await tokenDB.queryRow<{
          id: number;
          is_mintable: boolean;
          creator_principal: string;
          total_supply: number;
          canister_id: string;
          status: string;
          symbol: string;
        }>`
          SELECT id, is_mintable, creator_principal, total_supply, canister_id, status, symbol
          FROM tokens 
          WHERE id = ${req.tokenId}
        `;

        if (!token) {
          throw createAppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            "Token not found",
            { tokenId: req.tokenId },
            OperationType.TOKEN_MINT,
            operationId
          );
        }

        if (!token.is_mintable) {
          throw createAppError(
            ErrorCode.VALIDATION_ERROR,
            "Token is not mintable",
            { tokenId: req.tokenId, symbol: token.symbol },
            OperationType.TOKEN_MINT,
            operationId
          );
        }

        if (token.creator_principal !== creatorPrincipal) {
          throw createAppError(
            ErrorCode.UNAUTHORIZED_ACCESS,
            "Only token creator can mint tokens",
            { tokenId: req.tokenId, symbol: token.symbol },
            OperationType.TOKEN_MINT,
            operationId
          );
        }

        if (token.status !== 'deployed') {
          throw createAppError(
            ErrorCode.VALIDATION_ERROR,
            "Token is not deployed",
            { tokenId: req.tokenId, status: token.status },
            OperationType.TOKEN_MINT,
            operationId
          );
        }

        if (!token.canister_id) {
          throw createAppError(
            ErrorCode.VALIDATION_ERROR,
            "Token has no canister ID",
            { tokenId: req.tokenId },
            OperationType.TOKEN_MINT,
            operationId
          );
        }

        if (req.amount <= 0) {
          throw createAppError(
            ErrorCode.VALIDATION_ERROR,
            "Mint amount must be positive",
            { amount: req.amount },
            OperationType.TOKEN_MINT,
            operationId
          );
        }

        if (!req.delegationIdentity) {
          throw createAppError(
            ErrorCode.INVALID_DELEGATION,
            "Delegation identity is required",
            undefined,
            OperationType.TOKEN_MINT,
            operationId
          );
        }

        logger.info("Token validation passed for mint", {
          operationType: OperationType.TOKEN_MINT,
          operationId,
          tokenId: req.tokenId,
          canisterId: token.canister_id,
          metadata: {
            symbol: token.symbol,
            amount: req.amount,
            currentSupply: token.total_supply
          }
        });

        // Perform mint operation on ICP canister
        logger.info("Executing mint operation on canister", {
          operationType: OperationType.TOKEN_MINT,
          operationId,
          tokenId: req.tokenId,
          canisterId: token.canister_id,
          metadata: { amount: req.amount }
        });

        const result = await icp.performTokenOperation({
          canisterId: token.canister_id,
          operation: "mint",
          amount: req.amount.toString(),
          recipient: req.toPrincipal,
          delegationIdentity: req.delegationIdentity,
          ownerPrincipal: creatorPrincipal,
        });

        if (!result.success) {
          throw createAppError(
            ErrorCode.CANISTER_ERROR,
            "Mint operation failed on canister",
            { result },
            OperationType.TOKEN_MINT,
            operationId
          );
        }

        logger.info("Mint operation successful on canister", {
          operationType: OperationType.TOKEN_MINT,
          operationId,
          tokenId: req.tokenId,
          metadata: {
            transactionId: result.transactionId,
            blockIndex: result.blockIndex
          }
        });

        addBreadcrumb(
          "Mint operation completed on canister",
          "blockchain",
          "info",
          {
            transactionId: result.transactionId,
            blockIndex: result.blockIndex,
            amount: req.amount
          }
        );

        // Get updated token info from canister
        const tokenInfo = await icp.getTokenInfo({ canisterId: token.canister_id });
        const newTotalSupply = parseInt(tokenInfo.totalSupply);

        // Update database with new total supply
        await tokenDB.exec`
          UPDATE tokens 
          SET total_supply = ${newTotalSupply}
          WHERE id = ${req.tokenId}
        `;

        logger.info("Database updated with new total supply", {
          operationType: OperationType.TOKEN_MINT,
          operationId,
          tokenId: req.tokenId,
          metadata: {
            oldSupply: token.total_supply,
            newSupply: newTotalSupply
          }
        });

        // Log mint transaction
        await tokenDB.exec`
          INSERT INTO token_transactions (
            token_id, transaction_type, to_principal, amount, tx_hash, metadata
          ) VALUES (
            ${req.tokenId}, 'mint', ${req.toPrincipal}, ${req.amount}, ${result.transactionId},
            ${{ blockIndex: result.blockIndex, canisterOperation: true }}
          )
        `;

        logger.info("Mint transaction logged", {
          operationType: OperationType.TOKEN_MINT,
          operationId,
          tokenId: req.tokenId,
          metadata: { transactionId: result.transactionId }
        });

        logger.completeOperation(
          operationId,
          OperationType.TOKEN_MINT,
          "Token mint completed successfully",
          true,
          undefined,
          {
            tokenId: req.tokenId,
            amount: req.amount,
            newTotalSupply,
            transactionId: result.transactionId
          }
        );

        addBreadcrumb(
          "Token mint completed successfully",
          "token",
          "info",
          {
            tokenId: req.tokenId,
            amount: req.amount,
            newTotalSupply,
            transactionId: result.transactionId
          }
        );

        return {
          success: true,
          transactionId: result.transactionId,
          blockIndex: result.blockIndex || result.transactionId,
          newTotalSupply: tokenInfo.totalSupply,
          newBalance: result.newBalance || "0",
        };
      } catch (error) {
        logger.completeOperation(
          operationId,
          OperationType.TOKEN_MINT,
          "Token mint failed",
          false,
          undefined,
          {
            tokenId: req.tokenId,
            amount: req.amount,
            errorMessage: error instanceof Error ? error.message : String(error)
          }
        );

        return handleError(error as Error, "token.mint", OperationType.TOKEN_MINT, operationId);
      }
    }
  )
);
