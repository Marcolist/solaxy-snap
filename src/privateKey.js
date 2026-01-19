import nacl from 'tweetnacl';
import { SLIP10Node } from '@metamask/key-tree';
import { assertInput, assertIsArray } from './utils';

/**
 * Validates that a derivation path segment is a hardened index.
 *
 * SECURITY: Only hardened derivation (ending with ') is allowed.
 * This prevents key extraction attacks where a parent key could be
 * derived from a child key + parent public key.
 *
 * @param {string} segment - Must be format: "0'", "1'", "2'", etc.
 */
function isValidSegment(segment) {
  if (typeof segment !== 'string') {
    return false;
  }

  // SECURITY: Must end with ' to indicate hardened derivation
  // Regex: one or more digits followed by apostrophe (e.g., "0'", "10'", "2147483647'")
  if (!segment.match(/^[0-9]+'$/)) {
    return false;
  }

  const index = segment.slice(0, -1);

  if (parseInt(index).toString() !== index) {
    return false;
  }

  return true;
}

/**
 * Derives a keypair from BIP44 path using Ed25519 curve.
 *
 * SECURITY: All path segments must be hardened (validated by isValidSegment).
 * Base path is m/44'/501' (BIP44 + Solana coin type).
 *
 * @param {string[]} path - Array of hardened indices, e.g., ["0'", "0'"]
 */
export async function deriveKeyPair(path) {
  assertIsArray(path);
  assertInput(path.length);
  assertInput(path.every((segment) => isValidSegment(segment)));

  const rootNode = await snap.request({
    method: 'snap_getBip32Entropy',
    params: {
      path: [`m`, `44'`, `501'`],
      curve: 'ed25519'
    }
  });

  const node = await SLIP10Node.fromJSON(rootNode);

  const keypair = await node.derive(path.map((segment) => `slip10:${segment}`));

  return nacl.sign.keyPair.fromSeed(Uint8Array.from(keypair.privateKeyBytes));
}
