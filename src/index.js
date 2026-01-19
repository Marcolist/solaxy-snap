/* global module */

import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { panel, heading, text, divider } from '@metamask/snaps-ui';
import { deriveKeyPair } from './privateKey';
import {
  assertInput,
  assertConfirmation,
  assertAllStrings,
  assertIsString,
  assertIsBoolean,
  assertIsArray,
} from './utils';
import {
  renderGetPublicKey,
  renderSignTransaction,
  renderSignAllTransactions,
  renderSignMessage,
} from './ui';

// ==================================
// SOLAXY MAINNET CONFIGURATION
// ==================================

const SOLAXY_MAINNET = {
  networkId: 'mainnet',
  rpcUrl: 'https://mainnet.rpc.solaxy.io',
  name: 'Solaxy Mainnet',
  displayName: 'Solaxy',
  nativeCurrency: { name: 'Solaxy', symbol: 'SOLX', decimals: 9 },
  explorer: 'https://explorer.solaxy.io',
  bip44CoinType: 501,
};

// ==================================
// HELPERS
// ==================================

/**
 * Checks if domain is on the hardcoded trusted whitelist.
 *
 * SECURITY: Only official Solaxy domains are hardcoded.
 * This list is audit-covered and doesn't change without new audit.
 *
 * Domain names are case-insensitive per RFC 1035, so we normalize to lowercase.
 *
 * @param {string} hostname - Domain to check
 * @returns {boolean} True if hardcoded trusted
 */
function isHardcodedTrusted(hostname) {
  const normalized = hostname.toLowerCase();
  return normalized === 'solaxy.io' || normalized.endsWith('.solaxy.io');
}

/**
 * Validates that the request origin is authorized.
 *
 * SECURITY: Two-tier access control:
 * 1. solaxy.io domains (hardcoded) - Official apps, audit-covered
 * 2. User-approved domains - Dynamic approval for partners/ecosystem
 *
 * All origins must use HTTPS.

 * Domain names are normalized to lowercase for case-insensitive comparison.
 */
async function isAllowedOrigin(origin) {
  try {
    const url = new URL(origin);
    const { protocol, hostname } = url;
    const normalizedHostname = hostname.toLowerCase();

    // Require HTTPS for all domains
    if (protocol !== 'https:') return false;

    // Tier 1: Hardcoded trusted domains (audit-covered)
    if (isHardcodedTrusted(normalizedHostname)) {
      return true;
    }

    // Tier 2: User-approved domains (dynamic)

    const state = await getState();
    const approvedDomains = state.approvedDomains || [];

    return approvedDomains.includes(normalizedHostname);
  } catch {
    return false;
  }
}

async function getState() {
  const state = await snap.request({
    method: 'snap_manageState',
    params: { operation: 'get' },
  });
  return state || {};
}

async function setState(newState) {
  await snap.request({
    method: 'snap_manageState',
    params: { operation: 'update', newState },
  });
}

/**
 * Fetches and caches the Solaxy genesis hash.
 *
 * SECURITY: The genesis hash is cached in persistent storage to avoid
 * repeated RPC calls. This hash uniquely identifies the Solaxy chain.
 *
 * NOTE: Currently no TTL or revalidation. If the genesis hash changes
 * (e.g., chain fork/migration), users must reinstall the snap.
 */

async function getGenesisHash() {
  const state = await getState();
  if (state.genesisHash) return state.genesisHash;

  try {
    // Add timeout to prevent hanging requests
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const res = await fetch(SOLAXY_MAINNET.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getGenesisHash',
        params: [],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`RPC returned status ${res.status}`);
    }

    const json = await res.json();
    if (!json?.result) {
      throw new Error('Invalid RPC response: missing genesis hash');
    }

    await setState({ ...state, genesisHash: json.result });
    return json.result;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Request timeout: failed to fetch genesis hash from Solaxy RPC');
    }
    throw new Error(`Failed to resolve Solaxy genesis hash: ${error.message}`);
  }
}

async function getResolvedChainConfig() {
  const genesisHash = await getGenesisHash();
  const caip2Id = `solana:${genesisHash}`;

  return {
    ...SOLAXY_MAINNET,
    genesisHash,
    chainId: caip2Id,
    caip2Id,
    caip2Namespace: 'solana',
    caip2Reference: genesisHash,
  };
}

// ==================================
// MAIN RPC ENDPOINT
// ==================================

/**
 * Requests user approval for a new domain to access the snap.
 *
 * Domain names are normalized to lowercase before storage.
 * Deduplication ensures no duplicate entries in approved list.
 *
 * @param {string} hostname - The domain requesting access
 * @returns {Promise<boolean>} True if user approved
 */
async function requestDomainApproval(hostname) {
  const normalizedHostname = hostname.toLowerCase();

  const accepted = await snap.request({
    method: 'snap_dialog',
    params: {
      type: 'confirmation',
      content: panel([
        heading('⚠️ Domain Access Request'),
        text(`Website: ${hostname}`),
        divider(),
        text('This domain is requesting access to your Solaxy wallet.'),
        text(''),
        text('⚠️ Only approve domains you trust!'),
        text(''),
        text('The domain will be able to:'),
        text('• Request your public key'),
        text('• Request transaction signatures (with your approval)'),
        text('• Request message signatures (with your approval)'),
      ]),
    },
  });

  if (accepted) {
    const state = await getState();
    const approvedDomains = state.approvedDomains || [];

    // Deduplicate: only add if not already present
    if (!approvedDomains.includes(normalizedHostname)) {
      await setState({
        ...state,
        approvedDomains: [...approvedDomains, normalizedHostname],
      });
    }
  }

  return accepted;
}

export const onRpcRequest = async ({ origin, request }) => {
  if (!origin) {
    throw new Error('Invalid origin');
  }

  const url = new URL(origin);
  const hostname = url.hostname;

  // Check if origin is allowed
  const isAllowed = await isAllowedOrigin(origin);

  if (!isAllowed) {
    // For non-whitelisted domains, request user approval
    if (url.protocol === 'https:') {
      const approved = await requestDomainApproval(hostname);
      if (!approved) {
        throw new Error('Domain access denied by user');
      }
    } else {
      throw new Error('Invalid origin: HTTPS required');
    }
  }

  const dappHost = url.host;

  switch (request.method) {
    // ==================================
    // STANDARD METHODS
    // ==================================

    case 'eth_chainId': {
      const cfg = await getResolvedChainConfig();
      return cfg.chainId;
    }

    case 'wallet_switchEthereumChain': {
      const { chainId } = request.params?.[0] || {};
      const cfg = await getResolvedChainConfig();

      if (chainId !== cfg.chainId && chainId !== 'solaxy:mainnet') {
        throw new Error('Only Solaxy Mainnet is supported');
      }

      return cfg;
    }

    case 'wallet_addEthereumChain': {
      return null;
    }

    // ==================================
    // CHAIN INFO
    // ==================================

    case 'getChainId': {
      const cfg = await getResolvedChainConfig();
      return cfg.chainId;
    }

    case 'getChainConfig': {
      return getResolvedChainConfig();
    }

    case 'getCurrentChain': {
      return getResolvedChainConfig();
    }

    // ==================================
    // WALLET METHODS
    // ==================================

    case 'getPublicKey': {
      const { derivationPath, confirm = false } = request.params || {};
      assertIsBoolean(confirm);

      const keyPair = await deriveKeyPair(derivationPath);
      const pubkey = bs58.encode(keyPair.publicKey);

      if (confirm) {
        const accepted = await renderGetPublicKey(dappHost, pubkey);
        assertConfirmation(accepted);
      }

      return pubkey;
    }

    case 'signTransaction': {
      const { derivationPath, message } = request.params || {};
      assertInput(message);
      assertIsString(message);

      const keyPair = await deriveKeyPair(derivationPath);
      const cfg = await getResolvedChainConfig();

      const accepted = await renderSignTransaction(dappHost, message, cfg.name);
      assertConfirmation(accepted);

      let bytes;
      try {
        bytes = bs58.decode(message);
      } catch {
        throw new Error('Invalid base58 transaction');
      }

      const signature = nacl.sign.detached(bytes, keyPair.secretKey);

      return {
        publicKey: bs58.encode(keyPair.publicKey),
        signature: bs58.encode(signature),
        chainId: cfg.chainId,
      };
    }

    case 'signAllTransactions': {
      const { derivationPath, messages } = request.params || {};
      assertIsArray(messages);
      assertInput(messages.length);
      assertAllStrings(messages);

      const keyPair = await deriveKeyPair(derivationPath);
      const cfg = await getResolvedChainConfig();

      const accepted = await renderSignAllTransactions(dappHost, messages, cfg.name);
      assertConfirmation(accepted);

      const signatures = messages.map((msg) => {
        try {
          const bytes = bs58.decode(msg);
          return bs58.encode(nacl.sign.detached(bytes, keyPair.secretKey));
        } catch {
          throw new Error('Invalid base58 transaction in batch');
        }
      });

      return {
        publicKey: bs58.encode(keyPair.publicKey),
        signatures,
        chainId: cfg.chainId,
      };
    }

    case 'signMessage': {
      const { derivationPath, message, display = 'utf8' } = request.params || {};
      assertInput(message);
      assertIsString(message);
      assertIsString(display);

      // Validate display parameter (whitelist)
      if (display !== 'utf8' && display !== 'hex') {
        throw new Error('Invalid display parameter: must be "utf8" or "hex"');
      }

      const keyPair = await deriveKeyPair(derivationPath);
      const cfg = await getResolvedChainConfig();

      let bytes;
      try {
        bytes = bs58.decode(message);
      } catch {
        throw new Error('Invalid base58 message');
      }

      const decoded =
        display === 'hex'
          ? `0x${Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')}`
          : new TextDecoder().decode(bytes);

      const accepted = await renderSignMessage(dappHost, decoded);
      assertConfirmation(accepted);

      const signature = nacl.sign.detached(bytes, keyPair.secretKey);

      return {
        publicKey: bs58.encode(keyPair.publicKey),
        signature: bs58.encode(signature),
        chainId: cfg.chainId,
      };
    }

    // ==================================
    // DOMAIN MANAGEMENT METHODS
    // ==================================

    case 'listApprovedDomains': {
      const state = await getState();
      const approvedDomains = state.approvedDomains || [];

      return {
        hardcodedDomains: ['solaxy.io', '*.solaxy.io'],
        userApprovedDomains: approvedDomains,
        totalApproved: approvedDomains.length,
      };
    }

    case 'revokeDomain': {
      const { domain } = request.params || {};
      assertInput(domain);
      assertIsString(domain);

      const normalizedDomain = domain.toLowerCase();
      const state = await getState();
      const approvedDomains = state.approvedDomains || [];

      if (!approvedDomains.includes(normalizedDomain)) {
        throw new Error('Domain not in approved list');
      }

      const accepted = await snap.request({
        method: 'snap_dialog',
        params: {
          type: 'confirmation',
          content: panel([
            heading('Revoke Domain Access'),
            text(`Domain: ${domain}`),
            divider(),
            text('This will remove access for this domain.'),
            text('The domain will need to request approval again.'),
          ]),
        },
      });

      if (!accepted) {
        return { revoked: false };
      }

      await setState({
        ...state,
        approvedDomains: approvedDomains.filter((d) => d !== normalizedDomain),
      });

      return { revoked: true, domain: normalizedDomain };
    }

    case 'revokeAllDomains': {
      const state = await getState();
      const approvedDomains = state.approvedDomains || [];

      if (approvedDomains.length === 0) {
        return { revoked: 0, message: 'No approved domains to revoke' };
      }

      const accepted = await snap.request({
        method: 'snap_dialog',
        params: {
          type: 'confirmation',
          content: panel([
            heading('Revoke All Domain Access'),
            text(`Currently approved: ${approvedDomains.length} domains`),
            divider(),
            ...approvedDomains.map((d) => text(`• ${d}`)),
            divider(),
            text('⚠️ This will revoke access for all domains.'),
            text('They will need to request approval again.'),
          ]),
        },
      });

      if (!accepted) {
        return { revoked: 0 };
      }

      await setState({ ...state, approvedDomains: [] });

      return {
        revoked: approvedDomains.length,
        domains: approvedDomains,
      };
    }

    default:
      throw new Error('The requested method is not supported.');
  }
};

/* global module */

import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { panel, heading, text, divider } from '@metamask/snaps-ui';
import { deriveKeyPair } from './privateKey';
import {
  assertInput,
  assertConfirmation,
  assertAllStrings,
  assertIsString,
  assertIsBoolean,
  assertIsArray,
} from './utils';
import {
  renderGetPublicKey,
  renderSignTransaction,
  renderSignAllTransactions,
  renderSignMessage,
} from './ui';

// ==================================
// SOLAXY MAINNET CONFIGURATION
// ==================================

const SOLAXY_MAINNET = {
  networkId: 'mainnet',
  rpcUrl: 'https://mainnet.rpc.solaxy.io',
  name: 'Solaxy Mainnet',
  displayName: 'Solaxy',
  nativeCurrency: { name: 'Solaxy', symbol: 'SOLX', decimals: 9 },
  explorer: 'https://explorer.solaxy.io',
  bip44CoinType: 501,
};

// ==================================
// HELPERS
// ==================================

/**
 * Checks if domain is on the hardcoded trusted whitelist.
 *
 * SECURITY: Only official Solaxy domains are hardcoded.
 * This list is audit-covered and doesn't change without new audit.
 *
 * Domain names are case-insensitive per RFC 1035, so we normalize to lowercase.
 *
 * @param {string} hostname - Domain to check
 * @returns {boolean} True if hardcoded trusted
 */
function isHardcodedTrusted(hostname) {
  const normalized = hostname.toLowerCase();
  return normalized === 'solaxy.io' || normalized.endsWith('.solaxy.io');
}

/**
 * Validates that the request origin is authorized.
 *
 * SECURITY: Two-tier access control:
 * 1. solaxy.io domains (hardcoded) - Official apps, audit-covered
 * 2. User-approved domains - Dynamic approval for partners/ecosystem
 *
 * All origins must use HTTPS.

 * Domain names are normalized to lowercase for case-insensitive comparison.
 */
async function isAllowedOrigin(origin) {
  try {
    const url = new URL(origin);
    const { protocol, hostname } = url;
    const normalizedHostname = hostname.toLowerCase();

    // Require HTTPS for all domains
    if (protocol !== 'https:') return false;

    // Tier 1: Hardcoded trusted domains (audit-covered)
    if (isHardcodedTrusted(normalizedHostname)) {
      return true;
    }

    // Tier 2: User-approved domains (dynamic)








    const state = await getState();
    const approvedDomains = state.approvedDomains || [];

    return approvedDomains.includes(normalizedHostname);
  } catch {
    return false;
  }
}

async function getState() {
  const state = await snap.request({
    method: 'snap_manageState',
    params: { operation: 'get' },
  });
  return state || {};
}

async function setState(newState) {
  await snap.request({
    method: 'snap_manageState',
    params: { operation: 'update', newState },
  });
}

/**
 * Fetches and caches the Solaxy genesis hash.
 *
 * SECURITY: The genesis hash is cached in persistent storage to avoid
 * repeated RPC calls. This hash uniquely identifies the Solaxy chain.
 *
 * NOTE: Currently no TTL or revalidation. If the genesis hash changes
 * (e.g., chain fork/migration), users must reinstall the snap.
 */
async function getGenesisHash() {
  const state = await getState();
  if (state.genesisHash) return state.genesisHash;

  try {
    // Add timeout to prevent hanging requests
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const res = await fetch(SOLAXY_MAINNET.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getGenesisHash',
        params: [],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`RPC returned status ${res.status}`);
    }

    const json = await res.json();
    if (!json?.result) {
      throw new Error('Invalid RPC response: missing genesis hash');
    }

    await setState({ ...state, genesisHash: json.result });
    return json.result;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Request timeout: failed to fetch genesis hash from Solaxy RPC');
    }
    throw new Error(`Failed to resolve Solaxy genesis hash: ${error.message}`);
  }
}

async function getResolvedChainConfig() {
  const genesisHash = await getGenesisHash();
  const caip2Id = `solana:${genesisHash}`;

  return {
    ...SOLAXY_MAINNET,
    genesisHash,
    chainId: caip2Id,
    caip2Id,
    caip2Namespace: 'solana',
    caip2Reference: genesisHash,
  };
}

// ==================================
// MAIN RPC ENDPOINT
// ==================================

/**
 * Requests user approval for a new domain to access the snap.
 *
 * Domain names are normalized to lowercase before storage.
 * Deduplication ensures no duplicate entries in approved list.
 *
 * @param {string} hostname - The domain requesting access
 * @returns {Promise<boolean>} True if user approved
 */
async function requestDomainApproval(hostname) {
  const normalizedHostname = hostname.toLowerCase();

  const accepted = await snap.request({
    method: 'snap_dialog',
    params: {
      type: 'confirmation',
      content: panel([
        heading('⚠️ Domain Access Request'),
        text(`Website: ${hostname}`),
        divider(),
        text('This domain is requesting access to your Solaxy wallet.'),
        text(''),
        text('⚠️ Only approve domains you trust!'),
        text(''),
        text('The domain will be able to:'),
        text('• Request your public key'),
        text('• Request transaction signatures (with your approval)'),
        text('• Request message signatures (with your approval)'),
      ]),
    },
  });

  if (accepted) {
    const state = await getState();
    const approvedDomains = state.approvedDomains || [];

    // Deduplicate: only add if not already present
    if (!approvedDomains.includes(normalizedHostname)) {
      await setState({
        ...state,
        approvedDomains: [...approvedDomains, normalizedHostname],
      });
    }
  }

  return accepted;
}

export const onRpcRequest = async ({ origin, request }) => {
  if (!origin) {
    throw new Error('Invalid origin');
  }

  const url = new URL(origin);
  const hostname = url.hostname;

  // Check if origin is allowed
  const isAllowed = await isAllowedOrigin(origin);

  if (!isAllowed) {
    // For non-whitelisted domains, request user approval
    if (url.protocol === 'https:') {
      const approved = await requestDomainApproval(hostname);
      if (!approved) {
        throw new Error('Domain access denied by user');
      }
    } else {
      throw new Error('Invalid origin: HTTPS required');
    }
  }

  const dappHost = url.host;

  switch (request.method) {
    // ==================================
    // STANDARD METHODS
    // ==================================

    case 'eth_chainId': {
      const cfg = await getResolvedChainConfig();
      return cfg.chainId;
    }

    case 'wallet_switchEthereumChain': {
      const { chainId } = request.params?.[0] || {};
      const cfg = await getResolvedChainConfig();

      if (chainId !== cfg.chainId && chainId !== 'solaxy:mainnet') {
        throw new Error('Only Solaxy Mainnet is supported');
      }

      return cfg;
    }

    case 'wallet_addEthereumChain': {
      return null;
    }

    // ==================================
    // CHAIN INFO
    // ==================================

    case 'getChainId': {
      const cfg = await getResolvedChainConfig();
      return cfg.chainId;
    }

    case 'getChainConfig': {
      return getResolvedChainConfig();
    }

    case 'getCurrentChain': {
      return getResolvedChainConfig();
    }

    // ==================================
    // WALLET METHODS
    // ==================================

    case 'getPublicKey': {
      const { derivationPath, confirm = false } = request.params || {};
      assertIsBoolean(confirm);

      const keyPair = await deriveKeyPair(derivationPath);
      const pubkey = bs58.encode(keyPair.publicKey);

      if (confirm) {
        const accepted = await renderGetPublicKey(dappHost, pubkey);
        assertConfirmation(accepted);
      }

      return pubkey;
    }

    case 'signTransaction': {
      const { derivationPath, message } = request.params || {};
      assertInput(message);
      assertIsString(message);

      const keyPair = await deriveKeyPair(derivationPath);
      const cfg = await getResolvedChainConfig();

      const accepted = await renderSignTransaction(dappHost, message, cfg.name);
      assertConfirmation(accepted);

      let bytes;
      try {
        bytes = bs58.decode(message);
      } catch {
        throw new Error('Invalid base58 transaction');
      }

      const signature = nacl.sign.detached(bytes, keyPair.secretKey);

      return {
        publicKey: bs58.encode(keyPair.publicKey),
        signature: bs58.encode(signature),
        chainId: cfg.chainId,
      };
    }

    case 'signAllTransactions': {
      const { derivationPath, messages } = request.params || {};
      assertIsArray(messages);
      assertInput(messages.length);
      assertAllStrings(messages);

      const keyPair = await deriveKeyPair(derivationPath);
      const cfg = await getResolvedChainConfig();

      const accepted = await renderSignAllTransactions(dappHost, messages, cfg.name);
      assertConfirmation(accepted);

      const signatures = messages.map((msg) => {
        try {
          const bytes = bs58.decode(msg);
          return bs58.encode(nacl.sign.detached(bytes, keyPair.secretKey));
        } catch {
          throw new Error('Invalid base58 transaction in batch');
        }
      });

      return {
        publicKey: bs58.encode(keyPair.publicKey),
        signatures,
        chainId: cfg.chainId,
      };
    }

    case 'signMessage': {
      const { derivationPath, message, display = 'utf8' } = request.params || {};
      assertInput(message);
      assertIsString(message);
      assertIsString(display);

      // Validate display parameter (whitelist)
      if (display !== 'utf8' && display !== 'hex') {
        throw new Error('Invalid display parameter: must be "utf8" or "hex"');
      }

      const keyPair = await deriveKeyPair(derivationPath);
      const cfg = await getResolvedChainConfig();

      let bytes;
      try {
        bytes = bs58.decode(message);
      } catch {
        throw new Error('Invalid base58 message');
      }

      const decoded =
        display === 'hex'
          ? `0x${Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')}`
          : new TextDecoder().decode(bytes);

      const accepted = await renderSignMessage(dappHost, decoded);
      assertConfirmation(accepted);

      const signature = nacl.sign.detached(bytes, keyPair.secretKey);

      return {
        publicKey: bs58.encode(keyPair.publicKey),
        signature: bs58.encode(signature),
        chainId: cfg.chainId,
      };
    }

    // ==================================
    // DOMAIN MANAGEMENT METHODS
    // ==================================

    case 'listApprovedDomains': {
      const state = await getState();
      const approvedDomains = state.approvedDomains || [];

      return {
        hardcodedDomains: ['solaxy.io', '*.solaxy.io'],
        userApprovedDomains: approvedDomains,
        totalApproved: approvedDomains.length,
      };
    }

    case 'revokeDomain': {
      const { domain } = request.params || {};
      assertInput(domain);
      assertIsString(domain);

      const normalizedDomain = domain.toLowerCase();
      const state = await getState();
      const approvedDomains = state.approvedDomains || [];

      if (!approvedDomains.includes(normalizedDomain)) {
        throw new Error('Domain not in approved list');
      }

      const accepted = await snap.request({
        method: 'snap_dialog',
        params: {
          type: 'confirmation',
          content: panel([
            heading('Revoke Domain Access'),
            text(`Domain: ${domain}`),
            divider(),
            text('This will remove access for this domain.'),
            text('The domain will need to request approval again.'),
          ]),
        },
      });

      if (!accepted) {
        return { revoked: false };
      }

      await setState({
        ...state,
        approvedDomains: approvedDomains.filter((d) => d !== normalizedDomain),
      });

      return { revoked: true, domain: normalizedDomain };
    }

    case 'revokeAllDomains': {
      const state = await getState();
      const approvedDomains = state.approvedDomains || [];

      if (approvedDomains.length === 0) {
        return { revoked: 0, message: 'No approved domains to revoke' };
      }

      const accepted = await snap.request({
        method: 'snap_dialog',
        params: {
          type: 'confirmation',
          content: panel([
            heading('Revoke All Domain Access'),
            text(`Currently approved: ${approvedDomains.length} domains`),
            divider(),
            ...approvedDomains.map((d) => text(`• ${d}`)),
            divider(),
            text('⚠️ This will revoke access for all domains.'),
            text('They will need to request approval again.'),
          ]),
        },
      });

      if (!accepted) {
        return { revoked: 0 };
      }

      await setState({ ...state, approvedDomains: [] });

      return {
        revoked: approvedDomains.length,
        domains: approvedDomains,
      };
    }

    default:
      throw new Error('The requested method is not supported.');
  }
};

