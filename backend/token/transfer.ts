import { api, APIError } from "encore.dev/api";
import { tokenDB } from "./db";
import { icp } from "~encore/clients";

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
      throw APIError.notFound("Token not found");
    }

    if (token.status !== 'deployed') {
      throw APIError.failedPrecondition("Token is not deployed");
    }

    if (!token.canister_id) {
      throw APIError.failedPrecondition("Token has no canister ID");
    }

    if (req.amount <= 0) {
      throw APIError.invalidArgument("Transfer amount must be positive");
    }

    if (req.fromPrincipal === req.toPrincipal) {
      throw APIError.invalidArgument("Cannot transfer to the same account");
    }

    if (!req.delegationIdentity) {
      throw APIError.invalidArgument("Delegation identity is required");
    }

    try {
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
        throw APIError.invalidArgument(
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
        throw APIError.internal("Transfer operation failed on canister");
      }

      // Log transfer transaction
      await tokenDB.exec`
        INSERT INTO token_transactions (
          token_id, transaction_type, from_principal, to_principal, amount, fee_paid, tx_hash, metadata
        ) VALUES (
          ${req.tokenId}, 'transfer', ${req.fromPrincipal}, ${req.toPrincipal}, ${req.amount}, 
          ${transferFee}, ${result.transactionId},
          ${JSON.stringify({ blockIndex: result.blockIndex, canisterOperation: true, fee: transferFee })}
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
      console.error("ICP transfer operation failed:", error);
      throw APIError.internal("Failed to transfer tokens on ICP", error);
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
      throw APIError.notFound("Token not found");
    }

    if (token.status !== 'deployed') {
      throw APIError.failedPrecondition("Token is not deployed");
    }

    if (!token.canister_id) {
      throw APIError.failedPrecondition("Token has no canister ID");
    }

    try {
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
      console.error("Failed to get balance from ICP:", error);
      throw APIError.internal("Failed to get balance from ICP", error);
    }
  }
);
