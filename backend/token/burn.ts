import { api } from "encore.dev/api";
import { tokenDB } from "./db";
import { icp } from "~encore/clients";
import { tokenOperationLimiter } from "../common/rate-limiter";
import { handleError } from "../common/errors";

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
  async (req) => {
    try {
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
      }>`
        SELECT id, is_burnable, creator_principal, total_supply, canister_id, status
        FROM tokens 
        WHERE id = ${req.tokenId}
      `;

      if (!token) {
        throw new Error("Token not found");
      }

      if (!token.is_burnable) {
        throw new Error("Token is not burnable");
      }

      if (token.creator_principal !== creatorPrincipal) {
        throw new Error("Only token creator can burn tokens");
      }

      if (token.status !== 'deployed') {
        throw new Error("Token is not deployed");
      }

      if (!token.canister_id) {
        throw new Error("Token has no canister ID");
      }

      if (req.amount <= 0) {
        throw new Error("Burn amount must be positive");
      }

      if (!req.delegationIdentity) {
        throw new Error("Delegation identity is required");
      }

      // Check balance before burning
      const balanceResult = await icp.getBalance({
        canisterId: token.canister_id,
        principal: req.fromPrincipal,
      });

      const currentBalance = parseInt(balanceResult.balance);
      if (currentBalance < req.amount) {
        throw new Error(`Insufficient balance. Current: ${currentBalance}, Requested: ${req.amount}`);
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
        throw new Error("Burn operation failed on canister");
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

      return {
        success: true,
        transactionId: result.transactionId,
        blockIndex: result.blockIndex || result.transactionId,
        newTotalSupply: tokenInfo.totalSupply,
        newBalance: result.newBalance || "0",
      };
    } catch (error) {
      return handleError(error as Error, "token.burn");
    }
  }
);
