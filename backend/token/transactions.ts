import { api } from "encore.dev/api";
import { Query } from "encore.dev/api";
import { tokenDB } from "./db";

export interface Transaction {
  id: number;
  tokenId: number;
  transactionType: string;
  fromPrincipal?: string;
  toPrincipal?: string;
  amount?: number;
  feePaid?: number;
  txHash?: string;
  createdAt: Date;
  metadata?: any;
}

export interface GetTransactionsRequest {
  tokenId: number;
  limit?: Query<number>;
  offset?: Query<number>;
  type?: Query<string>;
}

export interface GetTransactionsResponse {
  transactions: Transaction[];
  total: number;
}

// Retrieves transaction history for a token.
export const getTransactions = api<GetTransactionsRequest, GetTransactionsResponse>(
  { expose: true, method: "GET", path: "/tokens/:tokenId/transactions" },
  async (req) => {
    const limit = req.limit ?? 50;
    const offset = req.offset ?? 0;

    let whereClause = "token_id = $1";
    const params: any[] = [req.tokenId];

    if (req.type) {
      whereClause += " AND transaction_type = $" + (params.length + 1);
      params.push(req.type);
    }

    const countQuery = `SELECT COUNT(*) as count FROM token_transactions WHERE ${whereClause}`;
    const totalRow = await tokenDB.rawQueryRow<{ count: number }>(countQuery, ...params);
    const total = totalRow?.count ?? 0;

    const query = `
      SELECT 
        id, token_id, transaction_type, from_principal, to_principal,
        amount, fee_paid, tx_hash, created_at, metadata
      FROM token_transactions 
      WHERE ${whereClause}
      ORDER BY created_at DESC 
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const rows = await tokenDB.rawQueryAll<{
      id: number;
      token_id: number;
      transaction_type: string;
      from_principal?: string;
      to_principal?: string;
      amount?: number;
      fee_paid?: number;
      tx_hash?: string;
      created_at: Date;
      metadata?: any;
    }>(query, ...params, limit, offset);

    const transactions: Transaction[] = rows.map(row => ({
      id: row.id,
      tokenId: row.token_id,
      transactionType: row.transaction_type,
      fromPrincipal: row.from_principal ?? undefined,
      toPrincipal: row.to_principal ?? undefined,
      amount: row.amount ?? undefined,
      feePaid: row.fee_paid ?? undefined,
      txHash: row.tx_hash ?? undefined,
      createdAt: row.created_at,
      metadata: row.metadata
    }));

    return { transactions, total };
  }
);
