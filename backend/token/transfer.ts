import { api } from "encore.dev/api";
import { tokenDB } from "./db";
import { icp } from "~encore/clients";
import { tokenOperationLimiter } from "../common/rate-limiter";
import { handleError, createAppError, ErrorCode } from "../common/errors";
import { logger, OperationType, withOperationLogging } from "../common/logger";
import { addBreadcrumb, setTag } from "../common/sentry";

export interface TransferTokenRequest {
  tokenId: number;
  amount: number;
  fromPrincipal: string;
  toPrincipal: string;
  delegationIdentity: any; // Delegation chain for authentication
}

export interface TransferTokenResponse {
  success: boolean;
  transactionId: string;
  blockIndex: string;
  transferFee: string;
  newBalance: string;
}

// Transfers tokens between accounts using ICP canister.
export const transfer = api<TransferTokenRequest, TransferTokenResponse>(
  { expose: true, method: "POST", path: "/tokens/:tokenId/transfer" },
  withOperationLogging(
    OperationType.TOKEN_TRANSFER,
    "Transfer Tokens",
    async (req) => {
      const operationId = logger.startOperation(
        OperationType.TOKEN_TRANSFER,
        "Token transfer initiated",
        {
          tokenId: req.tokenId,
          amount: req.amount.toString(),
          metadata: {
            fromPrincipal: req.fromPrincipal,
            toPrincipal: req.toPrincipal,
          }
        }
      );

      // Set Sentry tags for this operation
      setTag("operation_type", "token_transfer");
      setTag("token_id", req.tokenId.toString());

      try {
        // Add breadcrumb for transfer start
        addBreadcrumb(
          "Token transfer started",
          "token",
          "info",
          {
            tokenId: req.tokenId,
            amount: req.amount,
            operationId,
          }
        );

        // Rate limit transfer operations by sender
        await tokenOperationLimiter.checkLimit(req.fromPrincipal);

        logger.info("Rate limit check passed for transfer operation", {
          operationType: OperationType.TOKEN_TRANSFER,
          operationId,
          tokenId: req.tokenId,
          metadata: { amount: req.amount }
        });

        // Verify token exists and is deployed
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
            OperationType.TOKEN_TRANSFER,
            operationId
          );
        }

        if (token.status !== 'deployed') {
          throw createAppError(
            ErrorCode.VALIDATION_ERROR,
            "Token is not deployed",
            { tokenId: req.tokenId, status: token.status },
            OperationType.TOKEN_TRANSFER,
            operationId
          );
        }

        if (!token.canister_id) {
          throw createAppError(
            ErrorCode.VALIDATION_ERROR,
            "Token has no canister ID",
            { tokenId: req.tokenId },
            OperationType.TOKEN_TRANSFER,
            operationId
          );
        }

        if (req.amount <= 0) {
          throw createAppError(
            ErrorCode.VALIDATION_ERROR,
            "Transfer amount must be positive",
            { amount: req.amount },
            OperationType.TOKEN_TRANSFER,
            operationId
          );
        }

        if (req.fromPrincipal === req.toPrincipal) {
          throw createAppError(
            ErrorCode.VALIDATION_ERROR,
            "Cannot transfer to the same account",
            { principal: req.fromPrincipal },
            OperationType.TOKEN_TRANSFER,
            operationId
          );
        }

        if (!req.delegationIdentity) {
          throw createAppError(
            ErrorCode.INVALID_DELEGATION,
            "Delegation identity is required",
            undefined,
            OperationType.TOKEN_TRANSFER,
            operationId
          );
        }

        logger.info("Token validation passed for transfer", {
          operationType: OperationType.TOKEN_TRANSFER,
          operationId,
          tokenId: req.tokenId,
          canisterId: token.canister_id,
          metadata: {
            symbol: token.symbol,
            amount: req.amount
          }
        });

        // Check balance before transfer
        const balanceResult = await icp.getBalance({
          canisterId: token.canister_id,
          principal: req.fromPrincipal,
        });

        // Get token info to determine transfer fee
        const tokenInfo = await icp.getTokenInfo({ canisterId: token.canister_id });
        const transferFee = parseInt(tokenInfo.transferFee);
        const currentBalance = parseInt(balanceResult.balance);
        
        if (currentBalance < req.amount + transferFee) {
          throw createAppError(
            ErrorCode.INSUFFICIENT_FUNDS,
            `Insufficient balance. Current: ${currentBalance}, Required: ${req.amount + transferFee} (including fee: ${transferFee})`,
            { 
              currentBalance, 
              requiredAmount: req.amount + transferFee, 
              transferFee 
            },
            OperationType.TOKEN_TRANSFER,
            operationId
          );
        }

        logger.info("Balance check passed for transfer", {
          operationType: OperationType.TOKEN_TRANSFER,
          operationId,
          tokenId: req.tokenId,
          metadata: {
            currentBalance,
            transferAmount: req.amount,
            transferFee,
            totalRequired: req.amount + transferFee
          }
        });

        // Perform transfer operation on ICP canister
        logger.info("Executing transfer operation on canister", {
          operationType: OperationType.TOKEN_TRANSFER,
          operationId,
          tokenId: req.tokenId,
          canisterId: token.canister_id,
          metadata: { 
            amount: req.amount,
            transferFee
          }
        });

        const result = await icp.performTokenOperation({
          canisterId: token.canister_id,
          operation: "transfer",
          amount: req.amount.toString(),
          recipient: req.toPrincipal,
          delegationIdentity: req.delegationIdentity,
          ownerPrincipal: req.fromPrincipal,
        });

        if (!result.success) {
          throw createAppError(
            ErrorCode.CANISTER_ERROR,
            "Transfer operation failed on canister",
            { result },
            OperationType.TOKEN_TRANSFER,
            operationId
          );
        }

        logger.info("Transfer operation successful on canister", {
          operationType: OperationType.TOKEN_TRANSFER,
          operationId,
          tokenId: req.tokenId,
          metadata: {
            transactionId: result.transactionId,
            blockIndex: result.blockIndex,
            newBalance: result.newBalance
          }
        });

        addBreadcrumb(
          "Transfer operation completed on canister",
          "blockchain",
          "info",
          {
            transactionId: result.transactionId,
            blockIndex: result.blockIndex,
            amount: req.amount,
            transferFee
          }
        );

        // Log transfer transaction (structured metadata)
        await tokenDB.exec`
          INSERT INTO token_transactions (
            token_id, transaction_type, from_principal, to_principal, amount, fee_paid, tx_hash, metadata
          ) VALUES (
            ${req.tokenId}, 'transfer', ${req.fromPrincipal}, ${req.toPrincipal}, ${req.amount}, 
            ${transferFee}, ${result.transactionId},
            ${{
              blockIndex: result.blockIndex,
              canisterOperation: true,
              fee: transferFee
            }}
          )
        `;

        logger.info("Transfer transaction logged", {
          operationType: OperationType.TOKEN_TRANSFER,
          operationId,
          tokenId: req.tokenId,
          metadata: { 
            transactionId: result.transactionId,
            transferFee
          }
        });

        logger.completeOperation(
          operationId,
          OperationType.TOKEN_TRANSFER,
          "Token transfer completed successfully",
          true,
          undefined,
          {
            tokenId: req.tokenId,
            amount: req.amount,
            transferFee,
            transactionId: result.transactionId
          }
        );

        addBreadcrumb(
          "Token transfer completed successfully",
          "token",
          "info",
          {
            tokenId: req.tokenId,
            amount: req.amount,
            transferFee,
            transactionId: result.transactionId
          }
        );

        return {
          success: true,
          transactionId: result.transactionId,
          blockIndex: result.blockIndex || result.transactionId,
          transferFee: transferFee.toString(),
          newBalance: result.newBalance || "0",
        };
      } catch (error) {
        logger.completeOperation(
          operationId,
          OperationType.TOKEN_TRANSFER,
          "Token transfer failed",
          false,
          undefined,
          {
            tokenId: req.tokenId,
            amount: req.amount,
            errorMessage: error instanceof Error ? error.message : String(error)
          }
        );

        return handleError(error as Error, "token.transfer", OperationType.TOKEN_TRANSFER, operationId);
      }
    }
  )
);

export interface GetBalanceRequest {
  tokenId: number;
  principal: string;
  subaccount?: string;
}

export interface GetBalanceResponse {
  balance: string;
  decimals: number;
  symbol: string;
}

// Gets the balance of a specific account for a token.
export const getBalance = api<GetBalanceRequest, GetBalanceResponse>(
  { expose: true, method: "GET", path: "/tokens/:tokenId/balance/:principal" },
  withOperationLogging(
    OperationType.BALANCE_QUERY,
    "Get Token Balance",
    async (req) => {
      const operationId = logger.startOperation(
        OperationType.BALANCE_QUERY,
        "Balance query initiated",
        {
          tokenId: req.tokenId,
          metadata: {
            principal: req.principal,
            hasSubaccount: !!req.subaccount
          }
        }
      );

      try {
        // Get token info
        const token = await tokenDB.queryRow<{
          canister_id: string;
          status: string;
          symbol: string;
          decimals: number;
        }>`
          SELECT canister_id, status, symbol, decimals
          FROM tokens 
          WHERE id = ${req.tokenId}
        `;

        if (!token) {
          throw createAppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            "Token not found",
            { tokenId: req.tokenId },
            OperationType.BALANCE_QUERY,
            operationId
          );
        }

        if (token.status !== 'deployed') {
          throw createAppError(
            ErrorCode.VALIDATION_ERROR,
            "Token is not deployed",
            { tokenId: req.tokenId, status: token.status },
            OperationType.BALANCE_QUERY,
            operationId
          );
        }

        if (!token.canister_id) {
          throw createAppError(
            ErrorCode.VALIDATION_ERROR,
            "Token has no canister ID",
            { tokenId: req.tokenId },
            OperationType.BALANCE_QUERY,
            operationId
          );
        }

        logger.info("Querying balance from canister", {
          operationType: OperationType.BALANCE_QUERY,
          operationId,
          tokenId: req.tokenId,
          canisterId: token.canister_id,
          metadata: {
            symbol: token.symbol,
            principal: req.principal
          }
        });

        // Get balance from canister
        const balanceResult = await icp.getBalance({
          canisterId: token.canister_id,
          principal: req.principal,
          subaccount: req.subaccount,
        });

        logger.completeOperation(
          operationId,
          OperationType.BALANCE_QUERY,
          "Balance query completed successfully",
          true,
          undefined,
          {
            tokenId: req.tokenId,
            balance: balanceResult.balance,
            symbol: token.symbol
          }
        );

        return {
          balance: balanceResult.balance,
          decimals: token.decimals,
          symbol: token.symbol,
        };
      } catch (error) {
        logger.completeOperation(
          operationId,
          OperationType.BALANCE_QUERY,
          "Balance query failed",
          false,
          undefined,
          {
            tokenId: req.tokenId,
            errorMessage: error instanceof Error ? error.message : String(error)
          }
        );

        return handleError(error as Error, "token.getBalance", OperationType.BALANCE_QUERY, operationId);
      }
    }
  )
);
