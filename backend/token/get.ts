import { api, APIError } from "encore.dev/api";
import { tokenDB } from "./db";

export interface GetTokenRequest {
  id: number;
}

export interface TokenDetails {
  id: number;
  tokenName: string;
  symbol: string;
  totalSupply: number;
  decimals: number;
  logoUrl?: string;
  canisterId?: string;
  creatorPrincipal: string;
  createdAt: Date;
  isMintable: boolean;
  isBurnable: boolean;
  status: string;
  metadata?: any;
}

// Retrieves detailed information about a specific token.
export const get = api<GetTokenRequest, TokenDetails>(
  { expose: true, method: "GET", path: "/tokens/:id" },
  async (req) => {
    const row = await tokenDB.queryRow<{
      id: number;
      token_name: string;
      symbol: string;
      total_supply: number;
      decimals: number;
      logo_url?: string;
      canister_id?: string;
      creator_principal: string;
      created_at: Date;
      is_mintable: boolean;
      is_burnable: boolean;
      status: string;
      metadata?: any;
    }>`
      SELECT 
        id, token_name, symbol, total_supply, decimals, logo_url,
        canister_id, creator_principal, created_at, is_mintable, 
        is_burnable, status, metadata
      FROM tokens 
      WHERE id = ${req.id}
    `;

    if (!row) {
      throw APIError.notFound("Token not found");
    }

    return {
      id: row.id,
      tokenName: row.token_name,
      symbol: row.symbol,
      totalSupply: row.total_supply,
      decimals: row.decimals,
      logoUrl: row.logo_url ?? undefined,
      canisterId: row.canister_id ?? undefined,
      creatorPrincipal: row.creator_principal,
      createdAt: row.created_at,
      isMintable: row.is_mintable,
      isBurnable: row.is_burnable,
      status: row.status,
      metadata: row.metadata
    };
  }
);
