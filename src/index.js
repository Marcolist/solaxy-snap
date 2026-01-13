/* global module */

import nacl from 'tweetnacl';
import bs58 from 'bs58';
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

function isAllowedOrigin(origin) {
  try {
    const url = new URL(origin);
    const { protocol, hostname } = url;

    if (protocol === 'http:' && hostname === 'localhost') {
      return true;
    }

    if (protocol !== 'https:') return false;

    return (
      hostname === 'solaxy.io' ||
      hostname.endsWith('.solaxy.io') ||
      hostname === 'neptoon.me' ||
      hostname.endsWith('.neptoon.me') ||
      hostname === 'orbitnode.dev' ||
      hostname.endsWith('.orbitnode.dev')
    );
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

async function getGenesisHash() {
  const state = await getState();
  if (state.genesisHash) return state.genesisHash;

  const res = await fetch(SOLAXY_MAINNET.rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getGenesisHash',
      params: [],
    }),
  });

  const json = await res.json();
  if (!json?.result) {
    throw new Error('Failed to resolve Solaxy genesis hash');
  }

  await setState({ ...state, genesisHash: json.result });
  return json.result;
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
// MAIN RPC ENSOINT
// ==================================

export const onRpcRequest = async ({ origin, request }) => {
  if (!origin || !isAllowedOrigin(origin)) {
    throw new Error('Invalid origin');
  }

  const dappHost = new URL(origin).host;

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
        const bytes = bs58.decode(msg);
        return bs58.encode(nacl.sign.detached(bytes, keyPair.secretKey));
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
      assertIsString(display);

      const keyPair = await deriveKeyPair(derivationPath);
      const cfg = await getResolvedChainConfig();

      const bytes = bs58.decode(message);
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

    default:
      throw { code: 4200, message: 'The requested method is not supported.' };
  }
};
