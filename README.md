# TokenForge - Complete ICRC-1 Token Creation Platform

A comprehensive web application for creating and managing ICRC-1 tokens on the Internet Computer blockchain.

## Features

### Core Functionality
- **Token Creation**: Deploy production-ready ICRC-1 tokens with customizable parameters
- **Wallet Integration**: Seamless Internet Identity and NFID wallet support
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
- Internet Computer development environment

### Development Setup

1. **Clone and Install**
   ```bash
   git clone <repository>
   cd tokenforge
   npm install
   ```

2. **Configure Secrets**
   Set up the following secrets in the Encore dashboard:
   ```
   ICPHost=https://ic0.app
   DeployCyclesAmount=3000000000000
   UserCreationFeeICP=1
   TreasuryICPWallet=<your-treasury-principal>
   TreasuryCyclesWallet=kwhhn-qqaaa-aaaaj-qns2q-cai
   TreasuryDelegationIdentityJSON=<your-treasury-delegation-json>
   ICPLedgerCanisterId=ryjl3-tyaaa-aaaaa-aaaba-cai
   ICRCWasmModuleUrl=https://github.com/dfinity/ICRC-1/releases/download/v0.1.0/icrc1_ledger.wasm
   ```

3. **Run Development Server**
   ```bash
   encore run
   ```

4. **Access Application**
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
| `TreasuryICPWallet` | Treasury wallet principal for fee collection | `rrkah-...` |
| `TreasuryCyclesWallet` | Cycles wallet canister ID | `kwhhn-qqaaa-aaaaj-qns2q-cai` |
| `TreasuryDelegationIdentityJSON` | Treasury identity for cycles wallet operations | `{...}` |

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
