# Architecture Documentation

## Overview

The Solaxy Wallet Snap is a MetaMask Snap that provides Solana-compatible wallet functionality for the Solaxy blockchain. This document describes the system architecture, design decisions, and data flows.

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         dApp (Browser)                       │
│  https://solaxy.io, https://neptoon.me, etc.               │
└────────────────────────┬────────────────────────────────────┘
                         │ wallet_invokeSnap
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                     MetaMask Extension                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │         Snap Execution Environment (Sandbox)        │   │
│  │                                                       │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │   │
│  │  │  index.js    │  │ privateKey.js│  │  ui.js   │  │   │
│  │  │  (RPC Entry) │◄─┤ (Key Derive) │  │(Dialogs) │  │   │
│  │  └──────┬───────┘  └──────────────┘  └────▲─────┘  │   │
│  │         │                                  │         │   │
│  │         ▼                                  │         │   │
│  │  ┌──────────────┐                         │         │   │
│  │  │   utils.js   │                         │         │   │
│  │  │ (Validation) │                         │         │   │
│  │  └──────────────┘                         │         │   │
│  │                                            │         │   │
│  │  ┌──────────────────────────────────────┐│         │   │
│  │  │   MetaMask APIs:                     ││         │   │
│  │  │   - snap_manageState (storage)       ││         │   │
│  │  │   - snap_getBip32Entropy (keys)      ││         │   │
│  │  │   - snap_dialog (UI)                 │◄─────────┘   │
│  │  └──────────────────────────────────────┘│             │
│  └─────────────────────────────────────────────────────┘   │
└────────────────────────┬────────────────────────────────────┘
                         │ fetch (RPC calls)
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              Solaxy RPC Endpoint                             │
│          https://mainnet.rpc.solaxy.io                      │
└─────────────────────────────────────────────────────────────┘
```

## Component Breakdown

### 1. Entry Point: `src/index.js`

**Responsibilities**:
- RPC method routing
- Origin validation
- Chain configuration
- State management
- Genesis hash resolution

**Key Functions**:

| Function | Purpose |
|----------|---------|
| `onRpcRequest()` | Main RPC entry point, validates origin and routes requests |
| `isAllowedOrigin()` | Validates request comes from whitelisted domain |
| `getState()` / `setState()` | Manages persistent storage |
| `getGenesisHash()` | Fetches and caches genesis hash from RPC |
| `getResolvedChainConfig()` | Returns full chain config including genesis hash |

**Supported RPC Methods**:

| Method | Purpose |
|--------|---------|
| `eth_chainId` | Return chain ID (CAIP-2 format) |
| `wallet_switchEthereumChain` | Validate chain switch request |
| `wallet_addEthereumChain` | No-op (chain is hardcoded) |
| `getChainId` | Return chain ID |
| `getChainConfig` | Return full chain configuration |
| `getCurrentChain` | Alias for getChainConfig |
| `getPublicKey` | Derive and return public key |
| `signTransaction` | Sign single transaction |
| `signAllTransactions` | Sign multiple transactions |
| `signMessage` | Sign arbitrary message |
| `listApprovedDomains` | List all hardcoded and user-approved domains |
| `revokeDomain` | Revoke access for specific domain |
| `revokeAllDomains` | Revoke access for all user-approved domains |

### 2. Key Management: `src/privateKey.js`

**Responsibilities**:
- BIP44 key derivation
- Path validation (hardened only)
- KeyPair generation

**Security Model**:
- Base path: `m/44'/501'` (BIP44 Solana standard)
- Only hardened derivation allowed (prevents key extraction attacks)
- Uses MetaMask's `snap_getBip32Entropy` (keys never exposed to snap)
- Ed25519 curve via SLIP-10

**Key Derivation Flow**:
```
1. dApp requests derivationPath (e.g., ["0'", "0'"])
2. Validate path segments (hardened only)
3. Request entropy from MetaMask: m/44'/501'
4. Derive child key: m/44'/501'/0'/0'
5. Generate Ed25519 keypair from derived seed
6. Return keypair (used only within snap)
```

### 3. User Interface: `src/ui.js`

**Responsibilities**:
- Render confirmation dialogs
- Display transaction/message data
- Handle truncation of large data

**UI Components**:
- `renderGetPublicKey()`: Show public key for approval
- `renderSignTransaction()`: Show transaction to sign
- `renderSignAllTransactions()`: Show batch of transactions
- `renderSignMessage()`: Show message to sign

**UX Considerations**:
- Long data (>1200 chars) is truncated with head/tail preview
- Batch operations show max 10 items (UX limitation)
- All dialogs include origin hostname for transparency

### 4. Input Validation: `src/utils.js`

**Responsibilities**:
- Validate input types and sizes
- Throw standardized errors
- DoS prevention via limits

**Validation Functions**:
- `assertInput()`: Check for null/undefined
- `assertIsString()`: Type + length check (max 10k)
- `assertIsBoolean()`: Type check
- `assertIsArray()`: Type + length check (max 100)
- `assertAllStrings()`: Validate array of strings
- `assertConfirmation()`: Ensure user approved

## Data Flow Examples

### Example 1: Sign Transaction

```
1. dApp calls: wallet_invokeSnap({
     method: 'signTransaction',
     params: { derivationPath: ["0'"], message: "base58tx..." }
   })

2. MetaMask routes to snap's onRpcRequest()

3. Validate origin (isAllowedOrigin)
   ├─ Invalid → throw Error("Invalid origin")
   └─ Valid → continue

4. Validate params
   ├─ assertInput(message)
   └─ assertIsString(message)

5. Derive keypair
   └─ deriveKeyPair(["0'"]) → Ed25519 keypair

6. Get chain config
   └─ getResolvedChainConfig() → includes genesis hash

7. Show UI
   └─ renderSignTransaction(host, message, chainName)
       └─ User approves/rejects

8. Sign transaction
   ├─ Decode base58 message
   ├─ nacl.sign.detached(bytes, secretKey)
   └─ Encode signature as base58

9. Return { publicKey, signature, chainId }
```

### Example 2: Genesis Hash Resolution (First Call)

```
1. Any method needs chain config
   └─ getResolvedChainConfig()

2. Check cache
   └─ getState() → state.genesisHash === undefined

3. Fetch from RPC
   └─ fetch(https://mainnet.rpc.solaxy.io)
      POST { method: "getGenesisHash" }

4. Validate response
   ├─ No result → throw Error
   └─ Has result → continue

5. Cache in storage
   └─ setState({ genesisHash: "abc123..." })

6. Return full config
   └─ { ...SOLAXY_MAINNET, genesisHash, chainId: "solana:abc123..." }

7. Future calls
   └─ Read from cache (no RPC call)
```

## State Management

### Persistent Storage

**Stored Data**:
- `genesisHash` (string): Solaxy genesis hash

**Storage Mechanism**:
- MetaMask's `snap_manageState` API
- Encrypted at rest by MetaMask
- Persists across snap reloads
- Cleared on snap uninstall

**State Schema**:
```javascript
{
  genesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d", // example
  approvedDomains: ["partner.com", "dapp.example.io"] // user-approved domains
}
```

**Security Considerations**:
- No sensitive data stored (genesis hash is public, domain list is non-sensitive)
- No TTL on cached genesis hash (see Known Limitations in SECURITY.md)
- Approved domains persist across sessions (until revoked)
- State is snap-isolated (other snaps cannot access)

## RPC Endpoint Configuration

### Solaxy Mainnet RPC

**Endpoint**: `https://mainnet.rpc.solaxy.io`

**Ownership**: Solaxy Project

**Usage**:
- Fetch genesis hash (cached after first call)
- No transaction broadcasting (signing only)
- No balance queries (dApps handle that)

**Failure Handling**:
- Genesis hash fetch fails → Error thrown to dApp
- No automatic retry
- No fallback RPC endpoints

**Future Improvements**:
- Add fallback RPC URLs
- Implement retry logic with exponential backoff
- Add request timeout (currently none)

## Chain Configuration

### Solaxy Mainnet

```javascript
{
  networkId: 'mainnet',
  name: 'Solaxy Mainnet',
  displayName: 'Solaxy',
  rpcUrl: 'https://mainnet.rpc.solaxy.io',
  explorer: 'https://explorer.solaxy.io',
  bip44CoinType: 501, // Solana standard
  nativeCurrency: {
    name: 'Solaxy',
    symbol: 'SOLX',
    decimals: 9
  },
  // Resolved at runtime:
  genesisHash: "<fetched from RPC>",
  chainId: "solana:<genesisHash>", // CAIP-2 format
  caip2Namespace: "solana",
  caip2Reference: "<genesisHash>"
}
```

**Why BIP44 Coin Type 501?**
- Solaxy is Solana-compatible
- Uses same cryptography (Ed25519)
- Compatible with Solana tools/wallets

## Security Architecture

### Trust Model

**What We Trust**:
1. MetaMask Snap sandbox isolation
2. MetaMask's entropy generation (`snap_getBip32Entropy`)
3. Hardcoded whitelisted domains (`solaxy.io` and subdomains)
4. Solaxy RPC endpoint
5. User's ability to review transactions and approve domains

**What We Don't Trust**:
1. Any non-whitelisted origin (requires user approval)
2. User input from dApps (all validated)
3. Network (though no sensitive data transmitted)
4. User-approved domains (user responsibility)

### Attack Surface

**External Attack Surface**:
- `onRpcRequest()` is only entry point
- All parameters validated
- Origin access control:
  - Hardcoded whitelist for official domains
  - User approval required for others
  - User can manage approved domains

**No Attack Surface**:
- No network listeners
- No external dependencies at runtime
- No programmatic configuration (only user approvals)

### Cryptographic Guarantees

**Key Derivation**:
- BIP44 standard path
- Hardened derivation only (no key leakage)
- Ed25519 curve (industry standard)

**Signing**:
- Deterministic (Ed25519)
- User confirmation required
- Transaction data displayed

## Performance Considerations

### Optimization: Genesis Hash Caching

**Problem**: Every chain config request would hit RPC.

**Solution**: Cache genesis hash in persistent storage after first fetch.

**Trade-off**:
- ✅ Pro: Fast subsequent calls, no RPC dependency
- ❌ Con: Stale data if chain forks (requires reinstall)

### Limitation: Batch Operations

**UI Constraint**: MetaMask dialogs cannot scroll large lists.

**Solution**: Show only first 10 transactions in `signAllTransactions`.

**Trade-off**:
- ✅ Pro: Prevents UI overflow
- ❌ Con: User can't see all transactions (still signs all)

## Build & Deployment

### Build Process

```bash
npm run build
# Uses @metamask/snaps-cli
# Input: src/index.js
# Output: dist/bundle.js
```

### Deployment

```bash
npm publish
# Publishes to: @marcolist/solaxy-snap
# Users install via: npm:@marcolist/solaxy-snap
```

### Snap Manifest

**File**: `snap.manifest.json`

**Key Fields**:
- `source.shasum`: Bundle hash (integrity check)
- `initialPermissions`: Required MetaMask APIs
- `platformVersion`: MetaMask Snap API version

## Dependencies

### Production

| Package | Purpose | Security Notes |
|---------|---------|----------------|
| `tweetnacl` | Ed25519 signing | Industry standard, widely audited |
| `bs58` | Base58 encoding | Standard for Solana ecosystem |
| `@metamask/key-tree` | BIP44 derivation | Official MetaMask library |
| `@metamask/snaps-ui` | UI components | Official MetaMask library |

### Development

| Package | Purpose |
|---------|---------|
| `@metamask/snaps-cli` | Build & serve snap |

**No External Runtime Dependencies**: All crypto happens locally.

## Testing Strategy

**Current State**: No automated tests (see Known Limitations).

**Recommended Tests**:
1. Unit tests for all validation functions (`utils.js`)
2. Unit tests for key derivation (`privateKey.js`)
3. Integration tests for all RPC methods
4. E2E tests with real MetaMask + dApp

## Known Limitations

See `SECURITY.md` for security-specific limitations.

**Architectural Limitations**:
1. Single RPC endpoint (no failover)
2. No request timeouts
3. Genesis hash never revalidated
4. Batch UI limited to 10 items
5. No automatic rate limiting

## Future Improvements

1. **Multi-RPC Support**: Add fallback RPC endpoints
2. **Request Timeouts**: Add timeout to fetch calls
3. **Genesis Hash TTL**: Periodic revalidation
4. **Rate Limiting**: Implement request throttling
5. **Testnet Support**: Add Solaxy testnet configuration
6. **Transaction Parsing**: Display human-readable transaction details

## Audit Notes

For external auditors:

- **No dynamic code**: All code is static, no eval() or Function()
- **No external calls** except Solaxy RPC (genesis hash only)
- **Deterministic**: Same inputs always produce same outputs
- **Stateless signing**: No nonce management (Solana uses recent blockhash)
- **No transaction construction**: Snap only signs pre-built transactions

## Version

This architecture documentation applies to version 1.0.0 of the Solaxy Wallet Snap.

Last Updated: 2026-01-18
