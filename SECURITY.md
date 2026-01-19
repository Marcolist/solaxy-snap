# Security Documentation

## Overview

The Solaxy Wallet Snap is a MetaMask Snap that provides Solana-compatible wallet functionality for the Solaxy blockchain. This document outlines the security architecture, threat model, and trust assumptions.

## Trust Boundaries

### Trusted Components
- **MetaMask/Snap Framework**: We trust the MetaMask Snap execution environment to isolate our code and enforce permission boundaries
- **User**: We trust the user to approve/reject transactions, domain access requests, and understand what they're signing
- **Solaxy RPC Endpoint** (`https://mainnet.rpc.solaxy.io`): We trust this endpoint to provide valid blockchain data
- **Solaxy Official Domains** (`solaxy.io` and subdomains): Pre-approved domains under official project control

### Untrusted Components
- **Non-Whitelisted dApp Origins**: All external websites require explicit user approval before access
- **User Input**: All parameters from dApps are validated before use
- **Network**: Network responses are validated before being cached or used

## Threat Model

### Attack Vectors & Mitigations

#### 1. Malicious dApp Attacks

**Threat**: A malicious dApp attempts to extract private keys or trick users into signing unauthorized transactions.

**Mitigations**:
- ✅ **Two-Tier Access Control**:
  - **Tier 1**: `solaxy.io` domains (hardcoded whitelist, audit-covered)
  - **Tier 2**: User-approved domains (explicit user approval required)

- ✅ **Domain Approval Dialog**: Unknown domains must be explicitly approved by user
- ✅ **User Confirmation**: All signing operations require explicit user approval via MetaMask dialog
- ✅ **Transaction Display**: Transaction data is shown to users before signing
- ✅ **No Private Key Export**: Private keys never leave the snap execution environment
- ✅ **Revocation Support**: Users can revoke domain access at any time via `revokeDomain` or `revokeAllDomains` methods

#### 2. Input Validation Attacks

**Threat**: Malicious inputs attempt to cause crashes, DoS, or unexpected behavior.

**Mitigations**:
- ✅ **Input Length Limits**: Strings max 10,000 chars, arrays max 100 items
- ✅ **Type Validation**: All parameters are type-checked before use
- ✅ **Base58 Validation**: Transaction data must be valid base58 encoding
- ✅ **Derivation Path Validation**: Only hardened paths accepted (prevents key extraction)

#### 3. Key Derivation Attacks

**Threat**: Attacker attempts to derive parent keys from child keys, or trick snap into using non-hardened paths.

**Mitigations**:
- ✅ **Hardened-Only Derivation**: All derivation path segments must end with `'` (hardened)
- ✅ **BIP44 Compliance**: Base path is `m/44'/501'` (Solana standard)
- ✅ **Path Validation**: Regex + integer overflow checks on path segments

#### 4. State Manipulation

**Threat**: Attacker attempts to corrupt persistent state or inject malicious data.

**Mitigations**:
- ✅ **Minimal State**: Only genesis hash is persisted
- ✅ **Validation on Read**: Genesis hash is validated on first fetch
- ⚠️ **No TTL**: Genesis hash is cached indefinitely (see Known Limitations)

#### 5. Denial of Service

**Threat**: Attacker floods snap with requests to exhaust resources.

**Mitigations**:
- ✅ **Input Limits**: Max 100 transactions per batch, max 10,000 char strings
- ✅ **User Confirmation**: Every operation requires user action (natural rate limit)
- ⚠️ **No Automatic Rate Limiting**: Relies on MetaMask's rate limiting

#### 6. Wrong-Chain Attacks

**Threat**: User connects to malicious RPC that returns wrong genesis hash.

**Mitigations**:
- ✅ **Genesis Hash Cached**: Once fetched, genesis hash is persisted
- ✅ **Chain ID in Responses**: All signed transactions include chain ID
- ⚠️ **First-Use Trust**: Genesis hash from first RPC call is trusted (see Known Limitations)

## Domain Access Control

### Two-Tier Architecture

#### Tier 1: Hardcoded Whitelist (solaxy.io)





- **Domains**: `solaxy.io` and all subdomains (`*.solaxy.io`)
- **Status**: Audit-covered, hardcoded in source
- **Trust Level**: Fully trusted (official project domains)
- **Changes**: Require code update and new audit

#### Tier 2: User-Approved Domains
- **Mechanism**: Dynamic approval via confirmation dialog
- **Storage**: Encrypted snap state (MetaMask-managed)
- **Trust Level**: User-defined trust
- **Benefits**:
  - Ecosystem growth without snap updates
  - No new audit required for partner onboarding
  - User maintains full control

### Domain Management API

Users can manage approved domains via RPC methods:

- **`listApprovedDomains`**: View all approved domains
  ```javascript
  {
    hardcodedDomains: ['solaxy.io', '*.solaxy.io'],
    userApprovedDomains: ['partner.com', 'app.example.com'],
    totalApproved: 2
  }
  ```

- **`revokeDomain`**: Remove specific domain
  ```javascript
  { domain: 'partner.com' }
  ```

- **`revokeAllDomains`**: Remove all user-approved domains

### Security Properties

1. **Explicit Approval**: Each new domain requires user confirmation
2. **HTTPS Enforced**: Only HTTPS domains can be approved
3. **Full Disclosure**: Approval dialog explains permissions being granted
4. **Revocable**: Users can revoke access at any time
5. **Phishing Protection**: Domain name prominently displayed in all dialogs

## Security Assumptions

1. **MetaMask Snap Sandbox**: We assume the MetaMask Snap execution environment properly isolates our code and prevents direct access to user's master seed
2. **HTTPS**: We assume TLS protects communication with Solaxy RPC endpoints
3. **User Vigilance**: We assume users carefully review transaction details and domain approval requests before approval
4. **Domain Security**: We assume hardcoded Solaxy domains maintain security best practices

## Known Limitations

### Genesis Hash Caching
- **Issue**: Genesis hash is cached indefinitely without revalidation
- **Risk**: If Solaxy chain undergoes a hard fork/migration, cached genesis hash becomes invalid
- **Mitigation**: Users must manually reinstall snap to clear cache
- **Future**: Could implement TTL or periodic revalidation

### No Automatic Rate Limiting
- **Issue**: Snap relies on MetaMask's rate limiting and user confirmations
- **Risk**: DoS if MetaMask's limits are insufficient
- **Mitigation**: User confirmation dialogs provide natural rate limit

### Single RPC Endpoint
- **Issue**: Hardcoded to `https://mainnet.rpc.solaxy.io`
- **Risk**: Single point of failure if RPC endpoint is down or compromised
- **Mitigation**: None currently
- **Future**: Could implement fallback RPCs

### No Transaction Size Validation
- **Issue**: Only validates string length (10k chars), not actual transaction size
- **Risk**: Potentially allows oversized transactions
- **Mitigation**: String limit provides upper bound; Solaxy network will reject invalid transactions

## Cryptographic Primitives

- **Signature Algorithm**: Ed25519 (via TweetNaCl)
- **Key Derivation**: SLIP-10 (via @metamask/key-tree)
- **Encoding**: Base58 (via bs58)

All cryptographic libraries are industry-standard and regularly audited.

## Reporting Security Issues

If you discover a security vulnerability, please report it to:

**Email**: listmarco@gmail.com

**Please do NOT open a public GitHub issue for security vulnerabilities.**

## Audit History

- **[Date TBD]**: External security audit pending

## Version

This security documentation applies to version 1.0.0 of the Solaxy Wallet Snap.

Last Updated: 2026-01-18

