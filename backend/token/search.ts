import { api } from "encore.dev/api";
import { Query } from "encore.dev/api";
import { tokenDB } from "./db";

export interface SearchTokensRequest {
  query?: Query<string>;
  category?: Query<string>;
  minSupply?: Query<number>;
  maxSupply?: Query<number>;
  isMintable?: Query<boolean>;
  isBurnable?: Query<boolean>;
  status?: Query<string>;
  sortBy?: Query<string>;
  sortOrder?: Query<string>;
  limit?: Query<number>;
  offset?: Query<number>;
}

export interface TokenSearchResult {
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
  rank: number;
}

export interface SearchTokensResponse {
  tokens: TokenSearchResult[];
  total: number;
  filters: {
    categories: string[];
    statusOptions: string[];
    supplyRange: { min: number; max: number };
  };
}

// Searches and filters tokens with advanced criteria.
export const search = api<SearchTokensRequest, SearchTokensResponse>(
  { expose: true, method: "GET", path: "/tokens/search" },
  async (req) => {
    const limit = req.limit ?? 20;
    const offset = req.offset ?? 0;
    const sortBy = req.sortBy ?? "created_at";
    const sortOrder = req.sortOrder ?? "desc";

    let whereConditions: string[] = ["1=1"];
    const params: any[] = [];

    // Text search
    if (req.query) {
      whereConditions.push(`(token_name ILIKE $${params.length + 1} OR symbol ILIKE $${params.length + 1})`);
      params.push(`%${req.query}%`);
    }

    // Supply range filters
    if (req.minSupply !== undefined) {
      whereConditions.push(`total_supply >= $${params.length + 1}`);
      params.push(req.minSupply);
    }

    if (req.maxSupply !== undefined) {
      whereConditions.push(`total_supply <= $${params.length + 1}`);
      params.push(req.maxSupply);
    }

    // Feature filters
    if (req.isMintable !== undefined) {
      whereConditions.push(`is_mintable = $${params.length + 1}`);
      params.push(req.isMintable);
    }

    if (req.isBurnable !== undefined) {
      whereConditions.push(`is_burnable = $${params.length + 1}`);
      params.push(req.isBurnable);
    }

    // Status filter
    if (req.status) {
      whereConditions.push(`status = $${params.length + 1}`);
      params.push(req.status);
    }

    const whereClause = whereConditions.join(" AND ");

    // Get total count
    const countQuery = `SELECT COUNT(*) as count FROM tokens WHERE ${whereClause}`;
    const totalRow = await tokenDB.rawQueryRow<{ count: number }>(countQuery, ...params);
    const total = totalRow?.count ?? 0;

    // Validate sort column
    const validSortColumns = ["token_name", "symbol", "total_supply", "created_at", "status"];
    const sanitizedSortBy = validSortColumns.includes(sortBy) ? sortBy : "created_at";
    const sanitizedSortOrder = sortOrder.toLowerCase() === "asc" ? "ASC" : "DESC";

    // Get search results with ranking
    const searchQuery = `
      SELECT 
        id, token_name, symbol, total_supply, decimals, logo_url,
        canister_id, creator_principal, created_at, is_mintable, is_burnable, status,
        ROW_NUMBER() OVER (ORDER BY ${sanitizedSortBy} ${sanitizedSortOrder}) as rank
      FROM tokens 
      WHERE ${whereClause}
      ORDER BY ${sanitizedSortBy} ${sanitizedSortOrder}
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
      rank: number;
    }>(searchQuery, ...params, limit, offset);

    const tokens: TokenSearchResult[] = rows.map(row => ({
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
      rank: row.rank,
    }));

    // Get filter options
    const statusRows = await tokenDB.queryAll<{ status: string }>`
      SELECT DISTINCT status FROM tokens ORDER BY status
    `;

    const supplyRow = await tokenDB.queryRow<{ min: number; max: number }>`
      SELECT MIN(total_supply) as min, MAX(total_supply) as max FROM tokens
    `;

    const filters = {
      categories: ["DeFi", "Gaming", "NFT", "Utility", "Meme"], // Mock categories
      statusOptions: statusRows.map(row => row.status),
      supplyRange: {
        min: supplyRow?.min ?? 0,
        max: supplyRow?.max ?? 0,
      },
    };

    return { tokens, total, filters };
  }
);

export interface PopularTokensResponse {
  tokens: TokenSearchResult[];
}

// Retrieves trending and popular tokens.
export const getPopular = api<void, PopularTokensResponse>(
  { expose: true, method: "GET", path: "/tokens/popular" },
  async () => {
    // This would typically join with analytics data to get actual popularity metrics
    const rows = await tokenDB.queryAll<{
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
    }>`
      SELECT 
        id, token_name, symbol, total_supply, decimals, logo_url,
        canister_id, creator_principal, created_at, is_mintable, is_burnable, status
      FROM tokens 
      WHERE status = 'deployed'
      ORDER BY total_supply DESC, created_at DESC
      LIMIT 10
    `;

    const tokens: TokenSearchResult[] = rows.map((row, index) => ({
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
      rank: index + 1,
    }));

    return { tokens };
  }
);
