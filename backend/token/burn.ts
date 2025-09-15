import { api } from "encore.dev/api";
import { tokenDB } from "./db";
import { icp } from "~encore/clients";
import { tokenOperationLimiter } from "../common/rate-limiter";
import { handleError, createAppError, ErrorCode } from "../common/errors";
import { logger, OperationType, withOperationLogging } from "../common/logger";
import { addBreadcrumb, setTag } from "../common/sentry";

export interface BurnTokenRequest {
  tokenId: number;
  amount: number;
  fromPrincipal: string;
  creatorPrincipal: string;
  delegationIdentity: any; // Delegation chain for authentication
}

export interface BurnTokenResponse {
  success: boolean;
  transactionId: string;
  blockIndex: string;
  newTotalSupply: string;
  newBalance: string;
}

// Burns tokens from the total supply using ICP canister.
export const burn = api<BurnTokenRequest, BurnTokenResponse>(
  { expose: true, method: "POST", path: "/tokens/:tokenId/burn" },
  withOperationLogging(
    OperationType.TOKEN_BURN,
    "Burn Tokens",
    async (req) => {
      const operationId = logger.startOperation(
        OperationType.TOKEN_BURN,
        "Token burn initiated",
        {
          tokenId: req.tokenId,
          amount: req.amount.toString(),
          metadata: {
            fromPrincipal: req.fromPrincipal,
          }
        }
      );

      setTag("operation_type", "token_burn");
      setTag("token_id", req.tokenId.toString());

      try {
        addBreadcrumb(
          "Token burn started",
          "token",
          "info",
          {
            tokenId: req.tokenId,
            amount: req.amount,
            operationId,
          }
        );

        // Rate limit burn operations per creator
        await tokenOperationLimiter.checkLimit(req.creatorPrincipal);

        const creatorPrincipal = req.creatorPrincipal;

        // Verify token exists and is burnable
        const token = await tokenDB.queryRow<{
          id: number;
          is_burnable: boolean;
          creator_principal: string;
          total_supply: number;
          canister_id: string;
          status: string;
          symbol: string;
        }>`
          SELECT id, is_burnable, creator_principal, total_supply, canister_id, status, symbol
          FROM tokens 
          WHERE id = ${req.tokenId}
        `;

        if (!token) {
          throw createAppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            "Token not found",
            { tokenId: req.tokenId },
            OperationType.TOKEN_BURN,
            operationId
          );
        }

        if (!token.is_burnable) {
          throw createAppError(
            ErrorCode.VALIDATION_ERROR,
            "Token is not burnable",
            { tokenId: req.tokenId, symbol: token.symbol },
            OperationType.TOKEN_BURN,
            operationId
          );
        }

        if (token.creator_principal !== creatorPrincipal) {
          throw createAppError(
            ErrorCode.UNAUTHORIZED_ACCESS,
            "Only token creator can burn tokens",
            { tokenId: req.tokenId, symbol: token.symbol },
            OperationType.TOKEN_BURN,
            operationId
          );
        }

        if (token.status !== 'deployed') {
          throw createAppError(
            ErrorCode.VALIDATION_ERROR,
            "Token is not deployed",
            { tokenId: req.tokenId, status: token.status },
            OperationType.TOKEN_BURN,
            operationId
          );
        }

        if (!token.canister_id) {
          throw createAppError(
            ErrorCode.VALIDATION_ERROR,
            "Token has no canister ID",
            { tokenId: req.tokenId },
            OperationType.TOKEN_BURN,
            operationId
          );
        }

        if (req.amount <= 0) {
          throw createAppError(
            ErrorCode.VALIDATION_ERROR,
            "Burn amount must be positive",
            { amount: req.amount },
            OperationType.TOKEN_BURN,
            operationId
          );
        }

        if (!req.delegationIdentity) {
          throw createAppError(
            ErrorCode.INVALID_DELEGATION,
            "Delegation identity is required",
            undefined,
            OperationType.TOKEN_BURN,
            operationId
          );
        }

        // Check balance before burning
        const balanceResult = await icp.getBalance({
          canisterId: token.canister_id,
          principal: req.fromPrincipal,
        });

        const currentBalance = parseInt(balanceResult.balance);
        if (currentBalance < req.amount) {
          throw createAppError(
            ErrorCode.INSUFFICIENT_FUNDS,
            `Insufficient balance. Current: ${currentBalance}, Requested: ${req.amount}`,
            { currentBalance, requestedAmount: req.amount },
            OperationType.TOKEN_BURN,
            operationId
          );
        }

        // Perform burn operation on ICP canister
        const result = await icp.performTokenOperation({
          canisterId: token.canister_id,
          operation: "burn",
          amount: req.amount.toString(),
          delegationIdentity: req.delegationIdentity,
          ownerPrincipal: creatorPrincipal,
        });

        if (!result.success) {
          throw createAppError(
            ErrorCode.CANISTER_ERROR,
            "Burn operation failed on canister",
            { result },
            OperationType.TOKEN_BURN,
            operationId
          );
        }

        // Get updated token info from canister
        const tokenInfo = await icp.getTokenInfo({ canisterId: token.canister_id });
        const newTotalSupply = parseInt(tokenInfo.totalSupply);

        // Update database with new total supply
        await tokenDB.exec`
          UPDATE tokens 
          SET total_supply = ${newTotalSupply}
          WHERE id = ${req.tokenId}
        `;

        // Log burn transaction
        await tokenDB.exec`
          INSERT INTO token_transactions (
            token_id, transaction_type, from_principal, amount, tx_hash, metadata
          ) VALUES (
            ${req.tokenId}, 'burn', ${req.fromPrincipal}, ${req.amount}, ${result.transactionId},
            ${{ blockIndex: result.blockIndex, canisterOperation: true }}
          )
        `;

        logger.completeOperation(
          operationId,
          OperationType.TOKEN_BURN,
          "Token burn completed successfully",
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
          "Token burn completed successfully",
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
          OperationType.TOKEN_BURN,
          "Token burn failed",
          false,
          undefined,
          {
            tokenId: req.tokenId,
            amount: req.amount,
            errorMessage: error instanceof Error ? error.message : String(error)
          }
        );
        return handleError(error as Error, "token.burn", OperationType.TOKEN_BURN, operationId);
      }
    }
  )
);
