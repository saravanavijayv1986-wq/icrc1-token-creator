import { api } from "encore.dev/api";
import { secret } from "encore.dev/config";
import { Principal } from "@dfinity/principal";
import { Actor, HttpAgent, type ActorSubclass } from "@dfinity/agent";
import { managementIdlFactory } from "./idl";
import { parseTreasuryDelegationIdentity, createAuthenticatedAgent, createQueryAgentWithFallback } from "./canister";
import { monitor } from "../common/monitoring";
import { AppError, ErrorCode, handleError } from "../common/errors";
import log from "encore.dev/log";
import { Ed25519KeyIdentity } from "@dfinity/identity";

const treasuryCyclesWalletId = secret("TreasuryCyclesWallet");
const treasuryDelegationIdentityJSON = secret("TreasuryDelegationIdentityJSON");
const icpHost = secret("ICPHost");

export interface EnsureTreasuryWalletControllerRequest {
  // If true, only checks and returns the current controller status without attempting to change settings.
  dryRun?: boolean;
}

export interface EnsureTreasuryWalletControllerResponse {
  walletCanisterId: string;
  treasuryPrincipal: string;
  isController: boolean;
  controllers: string[];
  updated?: boolean;
  message?: string;
}

// Ensures the Treasury delegation principal is a controller of the Treasury Cycles Wallet canister.
// If not, attempts to add it via the management canister update_settings call.
// Note: The caller must already be a controller of the wallet for the update to succeed.
// If the update fails with "caller not authorized", follow the CLI instructions in the message.
export const ensureTreasuryWalletController = api<
  EnsureTreasuryWalletControllerRequest,
  EnsureTreasuryWalletControllerResponse
>(
  { expose: true, method: "POST", path: "/icp/setup/ensure-treasury-wallet-controller" },
  monitor("icp.ensureTreasuryWalletController", async (req) => {
    try {
      const walletIdText = (treasuryCyclesWalletId() || "").trim();
      const treasuryIdentityJson = treasuryDelegationIdentityJSON();

      if (!walletIdText) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          "TreasuryCyclesWallet secret is not configured"
        );
      }
      if (!treasuryIdentityJson) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          "TreasuryDelegationIdentityJSON secret is not configured"
        );
      }

      const walletId = Principal.fromText(walletIdText);
      const treasuryIdentity = parseTreasuryDelegationIdentity();
      const treasuryPrincipal = treasuryIdentity.getPrincipal().toText();

      // Use a query agent to fetch current controllers
      const queryAgent = await createQueryAgentWithFallback();
      const managementQuery = Actor.createActor(managementIdlFactory, {
        agent: queryAgent,
        canisterId: Principal.fromText("aaaaa-aa"),
      }) as ActorSubclass<any>;

      let status;
      try {
        status = await managementQuery.canister_status({ canister_id: walletId });
      } catch (e) {
        // Most likely not authorized to query status without being a controller.
        // Retry with the treasury identity (in case it's already a controller).
        try {
          const authAgent = await createAuthenticatedAgent(treasuryIdentity);
          const managementAuth = Actor.createActor(managementIdlFactory, {
            agent: authAgent,
            canisterId: Principal.fromText("aaaaa-aa"),
          }) as ActorSubclass<any>;
          status = await managementAuth.canister_status({ canister_id: walletId });
        } catch (err) {
          const host = icpHost() || "https://ic0.app";
          throw new AppError(
            ErrorCode.UNAUTHORIZED_ACCESS,
            "Unable to query wallet controllers (likely not a controller). " +
              "Run the provided CLI command to add the treasury principal as a controller.",
            {
              hint: `dfx canister --network ${host.includes("ic0.app") ? "ic" : "local"} update-settings --controller ${treasuryPrincipal} ${walletIdText}`,
            }
          );
        }
      }

      const controllers: string[] = status.settings.controllers.map((p: any) => p.toText());
      const isController = controllers.includes(treasuryPrincipal);

      if (req.dryRun) {
        return {
          walletCanisterId: walletIdText,
          treasuryPrincipal,
          isController,
          controllers,
          message: isController
            ? "Treasury principal is already a controller."
            : "Treasury principal is NOT a controller.",
        };
      }

      if (isController) {
        return {
          walletCanisterId: walletIdText,
          treasuryPrincipal,
          isController: true,
          controllers,
          message: "Treasury principal is already a controller.",
        };
      }

      // Attempt to add the treasury principal as a controller using the treasury identity
      // This will only succeed if the treasury identity is already a controller.
      try {
        const authAgent: HttpAgent = await createAuthenticatedAgent(treasuryIdentity);
        const management = Actor.createActor(managementIdlFactory, {
          agent: authAgent,
          canisterId: Principal.fromText("aaaaa-aa"),
        }) as ActorSubclass<any>;

        // Preserve existing controllers and add the treasury principal
        const newControllers = Array.from(new Set([...controllers, treasuryPrincipal])).map((t) =>
          Principal.fromText(t)
        );

        log.info("Attempting to update wallet controllers", {
          walletCanisterId: walletIdText,
          addController: "[TREASURY_PRINCIPAL_REDACTED]",
          totalControllers: newControllers.length,
        });

        await management.update_settings({
          canister_id: walletId,
          settings: {
            controllers: [newControllers],
            compute_allocation: [],
            memory_allocation: [],
            freezing_threshold: [],
          },
        });

        // Verify
        const verify = await management.canister_status({ canister_id: walletId });
        const verifyControllers: string[] = verify.settings.controllers.map((p: any) => p.toText());
        const nowController = verifyControllers.includes(treasuryPrincipal);

        return {
          walletCanisterId: walletIdText,
          treasuryPrincipal,
          isController: nowController,
          updated: nowController,
          controllers: verifyControllers,
          message: nowController
            ? "Treasury principal successfully added as controller."
            : "Unable to confirm controller update.",
        };
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        // Provide actionable CLI instructions
        return {
          walletCanisterId: walletIdText,
          treasuryPrincipal,
          isController: false,
          updated: false,
          controllers,
          message:
            "Failed to update controllers via backend (likely caller not authorized). " +
            `Please run:\n` +
            `dfx canister update-settings --controller ${treasuryPrincipal} ${walletIdText}\n` +
            `Then verify with:\n` +
            `dfx canister info ${walletIdText}\n` +
            `Error: ${errMsg}`,
        };
      }
    } catch (error) {
      return handleError(error as Error, "icp.ensureTreasuryWalletController");
    }
  })
);

export interface GenerateTreasuryIdentityResponse {
  identityJSON: string;
  principal: string;
  instructions: string;
}

// Generates a new identity for the treasury and provides instructions for setup.
export const generateTreasuryIdentity = api<void, GenerateTreasuryIdentityResponse>(
  { expose: true, method: "POST", path: "/icp/setup/generate-treasury-identity" },
  monitor("icp.generateTreasuryIdentity", async () => {
    try {
      const identity = Ed25519KeyIdentity.generate();
      const identityJSON = JSON.stringify(identity.toJSON());
      const principal = identity.getPrincipal().toText();
      const walletId = treasuryCyclesWalletId() || "<your-cycles-wallet-id>";
      const host = icpHost() || "https://ic0.app";
      const network = host.includes("ic0.app") ? "ic" : "local";

      const instructions = `
Setup Instructions:
1. Copy the 'identityJSON' value below and set it as the 'TreasuryDelegationIdentityJSON' secret in your Encore environment.
   - Go to the Infrastructure tab in Encore.
   - Find the 'TreasuryDelegationIdentityJSON' secret and click 'Edit'.
   - Paste the copied JSON value and save.

2. Add the new 'principal' as a controller to your cycles wallet.
   - Open your terminal.
   - Run the following command:
     dfx canister --network ${network} update-settings ${walletId} --add-controller ${principal}

3. Verify the controller was added.
   - Run: dfx canister --network ${network} info ${walletId}
   - Check that the new principal is listed under 'Controllers'.
`;

      return {
        identityJSON,
        principal,
        instructions,
      };
    } catch (error) {
      return handleError(error as Error, "icp.generateTreasuryIdentity");
    }
  })
);
