import { api, APIError } from "encore.dev/api";
import { tokenDB } from "./db";
import { icp } from "~encore/clients";

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
  async (req) => {
    const creatorPrincipal = req.creatorPrincipal;

    // Verify token exists and is mintable
    const token = await tokenDB.queryRow<{
      id: number;
      is_mintable: boolean;
      creator_principal: string;
      total_supply: number;
      canister_id: string;
      status: string;
    }>`
      SELECT id, is_mintable, creator_principal, total_supply, canister_id, status
      FROM tokens 
      WHERE id = ${req.tokenId}
    `;

    if (!token) {
      throw APIError.notFound("Token not found");
    }

    if (!token.is_mintable) {
      throw APIError.failedPrecondition("Token is not mintable");
    }

    if (token.creator_principal !== creatorPrincipal) {
      throw APIError.permissionDenied("Only token creator can mint tokens");
    }

    if (token.status !== 'deployed') {
      throw APIError.failedPrecondition("Token is not deployed");
    }

    if (!token.canister_id) {
      throw APIError.failedPrecondition("Token has no canister ID");
    }

    if (req.amount <= 0) {
      throw APIError.invalidArgument("Mint amount must be positive");
    }

    if (!req.delegationIdentity) {
      throw APIError.invalidArgument("Delegation identity is required");
    }

    try {
      // Perform mint operation on ICP canister
      const result = await icp.performTokenOperation({
        canisterId: token.canister_id,
        operation: "mint",
        amount: req.amount.toString(),
        recipient: req.toPrincipal,
        delegationIdentity: req.delegationIdentity,
        ownerPrincipal: creatorPrincipal,
      });

      if (!result.success) {
        throw APIError.internal("Mint operation failed on canister");
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

      // Log mint transaction
      await tokenDB.exec`
        INSERT INTO token_transactions (
          token_id, transaction_type, to_principal, amount, tx_hash, metadata
        ) VALUES (
          ${req.tokenId}, 'mint', ${req.toPrincipal}, ${req.amount}, ${result.transactionId},
          ${JSON.stringify({ blockIndex: result.blockIndex, canisterOperation: true })}
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
      console.error("ICP mint operation failed:", error);
      throw APIError.internal("Failed to mint tokens on ICP", error);
    }
  }
);
