# Domain Access Control Documentation

## Overview

The Solaxy Wallet Snap uses a **three-tier access control system** that balances security with ecosystem flexibility. This allows official Solaxy apps to have seamless access, while enabling partner integrations without requiring snap updates or new security audits.

## Three-Tier Architecture

### Tier 1: Development (localhost)

**Access Level**: Automatic (for local development)

- **Pattern**: `http://localhost` (any port)
- **Purpose**: Local snap development and integration testing
- **Protocol**: HTTP allowed (localhost only)
- **Security**: Only accessible from developer's local machine

### Tier 2: Hardcoded Whitelist (solaxy.io)

**Access Level**: Pre-approved (audit-covered)

- **Domains**: `solaxy.io` and ALL subdomains
- **Examples**:
  - `https://solaxy.io` (main website)
  - `https://app.solaxy.io` (web app)
  - `https://wallet.solaxy.io` (web wallet)
  - `https://explorer.solaxy.io` (block explorer)
  - `https://swap.solaxy.io` (DEX)
  - `https://bridge.solaxy.io` (bridge)
  - ANY future `*.solaxy.io` subdomain

**Properties**:
- ✅ No user approval required (seamless UX)
- ✅ Audit-covered (part of security review)
- ✅ Under official project control
- ✅ HTTPS required
- ⚠️ Changes require code update + new audit

**Why only solaxy.io?**
- These domains are under direct control of the Solaxy project
- All subdomains can be quickly provisioned without snap updates
- Keeps audit scope focused on official infrastructure

### Tier 3: User-Approved Domains

**Access Level**: User-granted (dynamic approval)

- **Any HTTPS domain** not in Tier 1 or 2
- **Examples**:
  - Partner dApps: `https://partner-dex.com`
  - Ecosystem apps: `https://nft-marketplace.xyz`
  - Third-party integrations: `https://defi-aggregator.io`

**Approval Flow**:
1. dApp attempts to call snap method
2. User sees confirmation dialog with domain name
3. User approves or rejects access
4. If approved, domain is saved to encrypted snap state
5. Future calls from same domain are automatic

**Properties**:
- ✅ Enables ecosystem growth without snap updates
- ✅ No audit required for new partners
- ✅ User maintains full control
- ✅ Revocable at any time
- ✅ HTTPS enforced
- ⚠️ Requires user action (one-time per domain)

## Approval Dialog

When a new domain requests access, users see:

```
⚠️ Domain Access Request

Website: partner-app.com

This domain is requesting access to your Solaxy wallet.

⚠️ Only approve domains you trust!

The domain will be able to:
• Request your public key
• Request transaction signatures (with your approval)
• Request message signatures (with your approval)

[Cancel] [Approve]
```

## Domain Management

Users can manage approved domains through RPC methods:

### List Approved Domains

```javascript
await ethereum.request({
  method: 'wallet_invokeSnap',
  params: {
    snapId: 'npm:@marcolist/solaxy-snap',
    request: {
      method: 'listApprovedDomains'
    }
  }
});

// Returns:
{
  hardcodedDomains: ['solaxy.io', '*.solaxy.io'],
  userApprovedDomains: ['partner.com', 'dex.example.io'],
  totalApproved: 2
}
```

### Revoke Specific Domain

```javascript
await ethereum.request({
  method: 'wallet_invokeSnap',
  params: {
    snapId: 'npm:@marcolist/solaxy-snap',
    request: {
      method: 'revokeDomain',
      params: { domain: 'partner.com' }
    }
  }
});

// Returns:
{ revoked: true, domain: 'partner.com' }
```

### Revoke All Domains

```javascript
await ethereum.request({
  method: 'wallet_invokeSnap',
  params: {
    snapId: 'npm:@marcolist/solaxy-snap',
    request: {
      method: 'revokeAllDomains'
    }
  }
});

// Returns:
{ revoked: 2, domains: ['partner.com', 'dex.example.io'] }
```

## Partner Integration Guide

### For Partners Wanting Integration

**Good News**: You don't need snap updates or audits!

**Steps**:
1. Build your dApp on HTTPS
2. Integrate with Solaxy Snap using standard methods
3. First-time users will see approval dialog
4. After approval, access is seamless

**Example Integration**:
```javascript
// Your partner dApp at https://your-app.com

// First call triggers approval dialog
const result = await ethereum.request({
  method: 'wallet_invokeSnap',
  params: {
    snapId: 'npm:@marcolist/solaxy-snap',
    request: {
      method: 'getPublicKey',
      params: { derivationPath: ["0'"], confirm: true }
    }
  }
});

// Future calls are automatic (no re-approval needed)
```

### Best Practices for Partners

1. ✅ Use HTTPS (required)
2. ✅ Explain to users why they're seeing approval dialog
3. ✅ Provide clear branding so users recognize your domain
4. ✅ Link to your security documentation
5. ✅ Consider adding Solaxy Snap logo/badge on your site

## Security Considerations

### Why This Design?

**Option A** (rejected): Hardcode all partners
- ❌ Requires snap update for each partner
- ❌ Requires new audit for each partner
- ❌ Slow ecosystem growth
- ❌ Centralized gatekeeping

**Option B** (rejected): No whitelist at all
- ❌ solaxy.io apps require user approval (bad UX)
- ❌ No distinction between official/third-party

**Option C** (chosen): Hybrid approach
- ✅ Official apps seamless (solaxy.io)
- ✅ Partners can integrate without gatekeeping
- ✅ Users maintain control
- ✅ No audit required for ecosystem growth

### Phishing Protection

**User Education**:
- Domain name is prominently shown in all dialogs
- Warning message: "Only approve domains you trust!"
- Users must explicitly click "Approve"

**Technical Protection**:
- HTTPS enforced (no HTTP except localhost)
- Domain stored as exact match (no wildcards for user-approved)
- MetaMask's anti-phishing measures apply

**Known Risk**: Users may approve phishing domains
- **Mitigation**: Clear warnings, education, domain prominence
- **Trade-off**: User freedom vs. protection
- **Decision**: Users should have final control

## Comparison Table

| Aspect | solaxy.io | User-Approved | Hardcoded Partners (Old) |
|--------|-----------|---------------|--------------------------|
| **Approval** | Automatic | One-time dialog | Automatic |
| **Audit Coverage** | Yes | No (user risk) | Yes |
| **Update Required** | No | No | Yes |
| **New Audit Required** | Only if code changes | No | Yes |
| **User Control** | None needed | Full control | None |
| **Revocable** | No (hardcoded) | Yes | No (hardcoded) |
| **Ecosystem Growth** | N/A (official only) | Fast | Slow |

## For Auditors

### Audit Scope

**In-Scope** (audit-covered):
- `solaxy.io` and `*.solaxy.io` hardcoded whitelist
- Domain approval mechanism
- Storage of approved domains (encrypted by MetaMask)
- Revocation mechanisms

**Out-of-Scope** (user responsibility):
- Security of user-approved domains
- Phishing attacks via social engineering
- User's decision to approve malicious domains

### Security Properties

1. **Isolation**: Each domain's approval is independent
2. **Persistence**: Approved domains persist across sessions
3. **Encryption**: Storage encrypted by MetaMask (snap state)
4. **No Wildcards**: User-approved domains are exact matches
5. **Revocability**: Users can revoke at any time

### Attack Scenarios

**Scenario 1**: Phishing site `solaxy.lo` (typo-squat)
- **Result**: User must explicitly approve
- **Mitigation**: Domain prominently displayed

**Scenario 2**: Compromised partner site
- **Result**: Can access snap if previously approved
- **Mitigation**: User can revoke; similar to browser cookie trust model

**Scenario 3**: Subdomain takeover on approved domain
- **Result**: Same domain has access
- **Mitigation**: Domains must maintain DNS security (standard web assumption)

## Version History

- **v1.0.0** (2026-01-18): Hybrid three-tier access control
  - Hardcoded: solaxy.io and subdomains
  - Dynamic: User-approved domains
  - Management: list/revoke RPC methods

## Contact

For questions about domain access control:
- **Email**: listmarco@gmail.com
- **GitHub**: https://github.com/Marcolist/solaxy-snap/issues

Last Updated: 2026-01-18
