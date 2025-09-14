import { api } from "encore.dev/api";
import { tokenDB } from "./db";
import { icp } from "~encore/clients";
import { tokenOperationLimiter } from "../common/rate-limiter";
import { handleError } from "../common/errors";

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
  async (req) => {
    try {
      // Rate limit transfer operations by sender
      await tokenOperationLimiter.checkLimit(req.fromPrincipal);

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
        throw new Error("Token not found");
      }

      if (token.status !== 'deployed') {
        throw new Error("Token is not deployed");
      }

      if (!token.canister_id) {
        throw new Error("Token has no canister ID");
      }

      if (req.amount <= 0) {
        throw new Error("Transfer amount must be positive");
      }

      if (req.fromPrincipal === req.toPrincipal) {
        throw new Error("Cannot transfer to the same account");
      }

      if (!req.delegationIdentity) {
        throw new Error("Delegation identity is required");
      }

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
        throw new Error(
          `Insufficient balance. Current: ${currentBalance}, Required: ${req.amount + transferFee} (including fee: ${transferFee})`
        );
      }

      // Perform transfer operation on ICP canister
      const result = await icp.performTokenOperation({
        canisterId: token.canister_id,
        operation: "transfer",
        amount: req.amount.toString(),
        recipient: req.toPrincipal,
        delegationIdentity: req.delegationIdentity,
        ownerPrincipal: req.fromPrincipal,
      });

      if (!result.success) {
        throw new Error("Transfer operation failed on canister");
      }

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

      return {
        success: true,
        transactionId: result.transactionId,
        blockIndex: result.blockIndex || result.transactionId,
        transferFee: transferFee.toString(),
        newBalance: result.newBalance || "0",
      };
    } catch (error) {
      return handleError(error as Error, "token.transfer");
    }
  }
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
  async (req) => {
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
        throw new Error("Token not found");
      }

      if (token.status !== 'deployed') {
        throw new Error("Token is not deployed");
      }

      if (!token.canister_id) {
        throw new Error("Token has no canister ID");
      }

      // Get balance from canister
      const balanceResult = await icp.getBalance({
        canisterId: token.canister_id,
        principal: req.principal,
        subaccount: req.subaccount,
      });

      return {
        balance: balanceResult.balance,
        decimals: token.decimals,
        symbol: token.symbol,
      };
    } catch (error) {
      return handleError(error as Error, "token.getBalance");
    }
  }
);
