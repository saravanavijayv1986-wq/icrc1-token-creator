import { api, APIError } from "encore.dev/api";
import { icp } from "~encore/clients";

export interface DeployCanisterRequest {
  tokenName: string;
  symbol: string;
  totalSupply: number;
  decimals: number;
  logoUrl?: string;
  isMintable: boolean;
  isBurnable: boolean;
  delegationIdentity: any;
  ownerPrincipal: string;
}

export interface DeployCanisterResponse {
  canisterId: string;
  status: string;
  deploymentHash: string;
  cyclesUsed: string;
}

// Deploys an ICRC-1 token canister to the Internet Computer.
export const deploy = api<DeployCanisterRequest, DeployCanisterResponse>(
  { expose: true, method: "POST", path: "/canister/deploy" },
  async (req) => {
    // Delegate to the ICP service for actual deployment
    return await icp.deploy(req);
  }
);

export interface CanisterStatus {
  canisterId: string;
  status: string;
  cyclesBalance: string;
  memorySize: string;
  lastUpdate: Date;
  moduleHash?: string;
}

// Retrieves the current status of a deployed canister.
export const getStatus = api<{ canisterId: string }, CanisterStatus>(
  { expose: true, method: "GET", path: "/canister/:canisterId/status" },
  async (req) => {
    // Delegate to the ICP service for status query
    return await icp.getStatus(req);
  }
);

export interface TokenOperationRequest {
  canisterId: string;
  operation: "mint" | "burn" | "transfer";
  amount: string;
  recipient?: string;
  delegationIdentity: any;
  ownerPrincipal: string;
}

export interface TokenOperationResponse {
  success: boolean;
  transactionId: string;
  newBalance?: string;
  blockIndex?: string;
}

// Performs token operations using the owner's delegation.
export const performTokenOperation = api<TokenOperationRequest, TokenOperationResponse>(
  { expose: true, method: "POST", path: "/canister/operation" },
  async (req) => {
    // Delegate to the ICP service for token operations
    return await icp.performTokenOperation(req);
  }
);
