import { api } from "encore.dev/api";
import { Query } from "encore.dev/api";
import { tokenDB } from "./db";

export interface Token {
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
}

export interface ListTokensRequest {
  limit?: Query<number>;
  offset?: Query<number>;
  creatorPrincipal?: Query<string>;
  status?: Query<string>;
}

export interface ListTokensResponse {
  tokens: Token[];
  total: number;
}

// Retrieves all tokens with optional filtering.
export const list = api<ListTokensRequest, ListTokensResponse>(
  { expose: true, method: "GET", path: "/tokens", auth: false },
  async (req) => {
    const limit = req.limit ?? 50;
    const offset = req.offset ?? 0;

    let whereClause = "1=1";
    const params: any[] = [];

    // Filter by creator principal
    if (req.creatorPrincipal) {
      whereClause += " AND creator_principal = $" + (params.length + 1);
      params.push(req.creatorPrincipal);
    }

    // Filter by status
    if (req.status) {
      whereClause += " AND status = $" + (params.length + 1);
      params.push(req.status);
    }

    const countQuery = `SELECT COUNT(*) as count FROM tokens WHERE ${whereClause}`;
    const totalRow = await tokenDB.rawQueryRow<{ count: number }>(countQuery, ...params);
    const total = totalRow?.count ?? 0;

    const query = `
      SELECT 
        id, token_name, symbol, total_supply, decimals, logo_url,
        canister_id, creator_principal, created_at, is_mintable, is_burnable, status
      FROM tokens 
      WHERE ${whereClause}
      ORDER BY created_at DESC 
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const rows = await tokenDB.rawQueryAll<{
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
    }>(query, ...params, limit, offset);

    const tokens: Token[] = rows.map(row => ({
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
      status: row.status
    }));

    return { tokens, total };
  }
);
