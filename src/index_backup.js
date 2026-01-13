/* global module */

import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { deriveKeyPair } from './privateKey';
import { assertInput, assertConfirmation, assertAllStrings, assertIsString, assertIsBoolean, assertIsArray } from './utils';
import { renderGetPublicKey, renderSignTransaction, renderSignAllTransactions, renderSignMessage } from './ui';

// ==================================
// SOLAXY CHAIN CONFIGURATION
// ==================================
// Genesis Hash for Solaxy
// This CAIP-2 ID uniquely identifies Solaxy and distinguishes it from Solana Mainnet
const SOLAXY_GENESIS_HASH = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const SOLAXY_CAIP2_ID = `solana:${SOLAXY_GENESIS_HASH}`;

const SOLAXY_CHAIN_CONFIG = {
  mainnet: {
    chainId: SOLAXY_CAIP2_ID,
    caip2Id: SOLAXY_CAIP2_ID,
    caip2Namespace: 'solana',
    caip2Reference: SOLAXY_GENESIS_HASH,
    networkId: 'mainnet',
    rpcUrl: 'https://mainnet.rpc.solaxy.io',
    name: 'Solaxy Mainnet',
    displayName: 'Solaxy',
    nativeCurrency: {
      name: 'Solaxy',
      symbol: 'SOLX',
      decimals: 9
    },
    explorer: 'https://explorer.solaxy.io',
    bip44CoinType: 501,
    requiresChainId: false
  },
  testnet: {
    chainId: 'solana:testnet',  // Testnet uses generic Solana namespace
    caip2Id: 'solana:testnet',
    caip2Namespace: 'solana',
    caip2Reference: 'testnet',
    networkId: 'testnet',
    rpcUrl: 'https://testnet.rpc.solaxy.io',
    name: 'Solaxy Testnet',
    displayName: 'Solaxy Testnet',
    nativeCurrency: {
      name: 'Solaxy',
      symbol: 'SOLX',
      decimals: 9
    },
    explorer: 'https://explorer.solaxy.io',
    bip44CoinType: 501,
    requiresChainId: false
  }
};

// Default Chain
const DEFAULT_CHAIN = SOLAXY_CHAIN_CONFIG.mainnet;

// Helper functions
function getChainConfig(networkId = 'mainnet') {
  return SOLAXY_CHAIN_CONFIG[networkId] || DEFAULT_CHAIN;
}

function getRpcUrl(params = {}) {
  const networkId = params.networkId || 'mainnet';
  return getChainConfig(networkId).rpcUrl;
}

// ==================================
// MAIN RPC HANDLER
// ==================================
export const onRpcRequest = async ({ origin, request }) => {
  if (
    !origin ||
    (
      !origin.match(/^https:\/\/(?:\S+\.)?solaxy\.io$/) &&
      !origin.match(/^https:\/\/(?:\S+\.)?neptoon\.me$/) &&
      !origin.match(/^https:\/\/(?:\S+\.)?orbitnode\.dev$/) &&
      !origin.match(/^http:\/\/localhost:\d+$/)  // Local Development
    )
  ) {
    throw new Error('Invalid origin');
  }

  const dappOrigin = request?.params?.origin || origin;
  const dappHost = (new URL(dappOrigin))?.host;

  switch (request.method) {
    // ==================================
    // METAMASK STANDARD METHODS
    // ==================================
    case 'eth_chainId': {
      // MetaMask's standard method for Chain-ID
      const state = await snap.request({
        method: 'snap_manageState',
        params: { operation: 'get' }
      });
      
      const networkId = state?.currentNetwork || 'mainnet';
      const config = getChainConfig(networkId);
      
      // Return the unique Solaxy Chain-ID
      return config.chainId;
    }

    case 'wallet_switchEthereumChain': {
      // MetaMask's standard method for chain switching
      const { chainId } = request.params[0] || {};
      
      let targetNetwork;
      // Support various Chain ID formats
      if (chainId === SOLAXY_CAIP2_ID || 
          chainId === 'solaxy:mainnet' || 
          chainId === '0x501' ||
          chainId === 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp') {
        targetNetwork = 'mainnet';
      } else if (chainId === 'solaxy:testnet' || 
                 chainId === 'solana:testnet') {
        targetNetwork = 'testnet';
      } else {
        throw new Error(`Unsupported chain: ${chainId}. Only Solaxy chain is supported.`);
      }
      
      // Switch to target chain
      await snap.request({
        method: 'snap_manageState',
        params: {
          operation: 'update',
          newState: { currentNetwork: targetNetwork }
        }
      });
      
      return getChainConfig(targetNetwork);
    }

    case 'wallet_addEthereumChain': {
      // MetaMask's method to add a chain
      // For Solaxy this is ignored as we only support Solaxy chain
      const params = request.params[0] || {};
      
      // Validate that it's a Solaxy chain
      if (!params.chainName?.includes('Solaxy')) {
        throw new Error('Only Solaxy chains can be added');
      }
      
      // Confirm that the chain was added
      return null;
    }

    // ==================================
    // CHAIN/NETWORK METHODS
    // ==================================
    case 'getChainId': {
      const { networkId } = request.params || {};
      const chainConfig = getChainConfig(networkId);
      return chainConfig.chainId;
    }

    case 'getNetworkId': {
      const { networkId } = request.params || {};
      const chainConfig = getChainConfig(networkId);
      return chainConfig.networkId;
    }

    case 'getChainConfig': {
      const { networkId } = request.params || {};
      return getChainConfig(networkId);
    }

    case 'switchChain': {
      const { networkId } = request.params || {};
      
      if (!SOLAXY_CHAIN_CONFIG[networkId]) {
        throw new Error(`Unsupported network: ${networkId}. Only mainnet and testnet are supported.`);
      }

      // Store the selected network in snap state
      await snap.request({
        method: 'snap_manageState',
        params: {
          operation: 'update',
          newState: { currentNetwork: networkId }
        }
      });

      return getChainConfig(networkId);
    }

    case 'getCurrentChain': {
      // Get current network from snap state
      const state = await snap.request({
        method: 'snap_manageState',
        params: { operation: 'get' }
      });

      const currentNetwork = state?.currentNetwork || 'mainnet';
      return getChainConfig(currentNetwork);
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
      const { derivationPath, message, networkId } = request.params || {};

      assertInput(message);
      assertIsString(message);

      const keyPair = await deriveKeyPair(derivationPath);
      const chainConfig = getChainConfig(networkId);

      // Show which network the transaction is for
      const accepted = await renderSignTransaction(
        dappHost, 
        message, 
        chainConfig.name
      );
      assertConfirmation(accepted);

      const signature = nacl.sign.detached(bs58.decode(message), keyPair.secretKey);

      return {
        publicKey: bs58.encode(keyPair.publicKey),
        signature: bs58.encode(signature),
        chainId: chainConfig.chainId
      };
    }

    case 'signAllTransactions': {
      const { derivationPath, messages, networkId } = request.params || {};

      assertInput(messages);
      assertIsArray(messages);
      assertInput(messages.length);
      assertAllStrings(messages);

      const keyPair = await deriveKeyPair(derivationPath);
      const chainConfig = getChainConfig(networkId);

      const accepted = await renderSignAllTransactions(
        dappHost, 
        messages, 
        chainConfig.name
      );
      assertConfirmation(accepted);

      const signatures = messages
        .map((message) => bs58.decode(message))
        .map((message) => nacl.sign.detached(message, keyPair.secretKey))
        .map((signature) => bs58.encode(signature));

      return {
        publicKey: bs58.encode(keyPair.publicKey),
        signatures,
        chainId: chainConfig.chainId
      };
    }

    case 'signMessage': {
      const { derivationPath, message, display = 'utf8', networkId } = request.params || {};

      assertInput(message);
      assertIsString(message);
      assertIsString(display);

      const keyPair = await deriveKeyPair(derivationPath);
      const chainConfig = getChainConfig(networkId);

      const messageBytes = bs58.decode(message);

      let decodedMessage = '';
      if (display.toLowerCase() === 'utf8') {
        decodedMessage = (new TextDecoder()).decode(messageBytes);
      } else if (display.toLowerCase() === 'hex') {
        decodedMessage = `0x${Array.prototype.map.call(messageBytes, (x) => (`00${x.toString(16)}`).slice(-2)).join('')}`;
      } else {
        decodedMessage = 'Unable to decode message';
      }

      const accepted = await renderSignMessage(dappHost, decodedMessage);
      assertConfirmation(accepted);

      const signature = nacl.sign.detached(messageBytes, keyPair.secretKey);

      return {
        publicKey: bs58.encode(keyPair.publicKey),
        signature: bs58.encode(signature),
        chainId: chainConfig.chainId
      };
    }

    default:
      throw {
        code: 4200,
        message: 'The requested method is not supported.'
      };
  }
};
