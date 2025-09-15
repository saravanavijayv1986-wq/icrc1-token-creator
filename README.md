# TokenForge

TokenForge is an enterprise-grade platform for creating and managing ICRC-1 compliant fungible tokens on the Internet Computer. It provides a streamlined, secure, and transparent process for deploying production-ready tokens in minutes.

## Features

-   **Simple Token Creation**: An intuitive UI to configure and deploy your token without writing any code.
-   **ICRC-1 Compliance**: All tokens are fully compliant with the official ICRC-1 fungible token standard.
-   **Full Lifecycle Management**: Mint, burn, and transfer tokens directly from your dashboard.
-   **Production-Ready Canisters**: Deploys secure, auditable token canisters to the IC mainnet.
-   **Comprehensive Dashboard**: Manage your tokens, view balances, and monitor transaction history.
-   **Advanced Analytics**: In-depth analytics for both individual tokens and the entire platform.
-   **Canister Monitoring**: Real-time health, performance, and cycle monitoring for your deployed canisters.
-   **Transparent & Auditable**: All creation and transfer operations are logged on-chain.

## Tech Stack

-   **Backend**: Encore.ts, TypeScript
-   **Frontend**: React, TypeScript, Vite, Tailwind CSS, shadcn/ui
-   **Blockchain**: Internet Computer (ICP)
-   **Authentication**: Internet Identity

## Project Structure

The project is a monorepo containing the frontend and backend services:

-   `frontend/`: The React-based user interface.
-   `backend/`: Multiple Encore.ts microservices handling business logic.
    -   `token/`: Core service for token creation and management.
    -   `icp/`: Service for interacting with the Internet Computer blockchain.
    -   `analytics/`: Service for collecting and serving analytics data.
    -   `monitoring/`: Service for monitoring canister health and performance.
    -   `health/`: Health check endpoints for the platform.
    -   `common/`: Shared utilities for logging, errors, validation, etc.

## Getting Started

This project is designed to be run within the Leap development environment.

1.  **Connect Wallet**: Connect your Internet Identity to authenticate.
2.  **Create Token**: Navigate to the "Create Token" page, fill in your token details, and deploy.
3.  **Manage**: Use the dashboard to manage your newly created token.

The platform handles canister deployment, cycle management (via a pre-configured treasury), and all on-chain interactions, providing a seamless user experience.

## Production Notes

Use ICRC_WASM_URL from dfinity/ic → ledger-suite-icrc-YYYY-MM-DD → ic-icrc1-ledger.wasm.gz, and verify ICRC_WASM_SHA256.

ICP ledger canister id: ryjl3-tyaaa-aaaaa-aaaba-cai.

Ensure treasury principal is a controller of your cycles wallet; load TREASURY_DELEGATION_IDENTITY_JSON in prod.

Always read balances via the new token’s ledger canister id with an ICRC account (owner + optional subaccount).

If you need transaction history, deploy the ICRC index canister matching the same ledger-suite version.

