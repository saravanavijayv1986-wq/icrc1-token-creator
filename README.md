# TokenForge - Complete ICRC-1 Token Creation Platform

A comprehensive web application for creating and managing ICRC-1 tokens on the Internet Computer blockchain.

## Features

### Core Functionality
- **Token Creation**: Deploy production-ready ICRC-1 tokens with customizable parameters
- **Wallet Integration**: Seamless Internet Identity wallet support
- **Token Management**: Mint, burn, and transfer tokens with full canister control
- **Real-time Analytics**: Comprehensive dashboards for token metrics and platform statistics
- **Health Monitoring**: Canister health monitoring with alerts and performance tracking

### Technical Features
- **Production Ready**: Full deployment pipeline with cycle wallet integration
- **Type Safe**: End-to-end TypeScript with automatic API client generation
- **Scalable**: Microservices architecture with proper error handling and monitoring
- **Secure**: Rate limiting, input validation, and secure delegation handling
- **Compliant**: Full ICRC-1 standard compliance with extensible features

## Architecture

### Backend Services
- **Token Service**: Core token CRUD operations and blockchain interactions
- **ICP Service**: Internet Computer integration and canister management
- **Analytics Service**: Metrics collection and reporting
- **Monitoring Service**: Health checks and alerting
- **Health Service**: System status and diagnostics

### Frontend
- **React + TypeScript**: Modern React application with full type safety
- **TanStack Query**: Efficient data fetching and caching
- **Tailwind CSS**: Responsive design with shadcn/ui components
- **Real-time Updates**: Live data refresh and notifications

## Quick Start

### Prerequisites
- Node.js 18+
- Encore CLI
- Internet Computer development environment (`dfx`)

### Development Setup

1. **Clone and Install**
   ```bash
   git clone <repository>
   cd tokenforge
   npm install
   ```

2. **Run Development Server**
   ```bash
   encore run
   ```

3. **Treasury Setup**
   The application needs a dedicated identity to manage the cycles wallet for canister deployments. We provide an endpoint to simplify this process.
   
   a. **Generate Treasury Identity:**
      Once the application is running, use a tool like `curl` or Postman to call the setup endpoint:
      ```bash
      curl -X POST http://localhost:4000/icp/setup/generate-treasury-identity
      ```
   
   b. **Set the Secret:**
      The command will return a JSON object containing `identityJSON`, `principal`, and `instructions`.
      - Copy the value of `identityJSON`.
      - In the Encore dashboard, go to the "Infrastructure" tab, find the `TreasuryDelegationIdentityJSON` secret, and paste the copied value.
   
   c. **Add Controller to Cycles Wallet:**
      - Follow the `instructions` from the endpoint response to add the new `principal` as a controller to your cycles wallet. This typically involves running a `dfx` command like:
      ```bash
      dfx canister --network ic update-settings <your-cycles-wallet-id> --add-controller <the-new-principal>
      ```

4. **Configure Other Secrets**
   Set up the remaining secrets in the Encore dashboard.
   ```
   ICPHost=https://ic0.app
   DeployCyclesAmount=3000000000000
   UserCreationFeeICP=1
   TreasuryICPWallet=<your-treasury-principal>
   TreasuryCyclesWallet=kwhhn-qqaaa-aaaaj-qns2q-cai
   # TreasuryDelegationIdentityJSON is set in the previous step
   ICPLedgerCanisterId=ryjl3-tyaaa-aaaaa-aaaba-cai
   ICRCWasmModuleUrl=https://github.com/dfinity/ICRC-1/releases/download/v0.1.0/icrc1_ledger.wasm
   ```

5. **Access Application**
   - Backend API: http://localhost:4000
   - Frontend: http://localhost:5173

### Production Deployment

1. **Deploy Backend**
   ```bash
   encore deploy
   ```

2. **Configure Production Secrets**
   - Set all required secrets in production environment
   - Configure treasury wallet with proper controllers
   - Verify cycles wallet setup

3. **Frontend Deployment**
   - Build frontend: `npm run build`
   - Deploy to your preferred hosting platform
   - Configure production API endpoints

## Configuration

### Required Secrets

| Secret | Description | Example |
|--------|-------------|---------|
| `ICPHost` | Internet Computer API endpoint | `https://ic0.app` |
| `DeployCyclesAmount` | Cycles for token canister deployment | `3000000000000` |
| `UserCreationFeeICP` | Fee in ICP for token creation | `1` |
| `TreasuryICPWallet` | The principal ID for the treasury where token creation fees (in ICP) are collected. This must be a standard principal ID (e.g., `rrkah-...`), not a 64-character hex account ID. The application will transfer ICP to the default account of this principal. | `rrkah-...` |
| `TreasuryCyclesWallet` | Cycles wallet canister ID | `kwhhn-qqaaa-aaaaj-qns2q-cai` |
| `TreasuryDelegationIdentityJSON` | JSON for the treasury identity that controls the cycles wallet. | See "Treasury Setup" section. |

### Optional Configuration

| Secret | Description | Default |
|--------|-------------|---------|
| `ICPLedgerCanisterId` | ICP Ledger canister override | `ryjl3-tyaaa-aaaaa-aaaba-cai` |
| `ICRCWasmModuleUrl` | ICRC-1 WASM module URL | GitHub release URL |
| `ICRCWasmSHA256` | WASM module checksum | (optional) |
| `SkipUserFeeDuringDev` | Skip fee collection in development | `false` |

## API Documentation

### Token Endpoints
- `POST /tokens` - Create new token
- `GET /tokens` - List tokens
- `GET /tokens
