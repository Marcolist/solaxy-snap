import { panel, heading, text, copyable, divider } from '@metamask/snaps-ui';

// UX + SECURITY: UI display limits
// MAX_COPYABLE_CHARS: MetaMask dialog size limit (defensive: 1200 chars to ensure rendering)
// MAX_BATCH_ITEMS: Show only first 10 items in batch operations for UX (user can't scroll large lists)
const MAX_COPYABLE_CHARS = 1200;
const MAX_BATCH_ITEMS = 10;

function safeCopyable(label, value) {
  const s = String(value ?? '');
  if (s.length <= MAX_COPYABLE_CHARS) {
    return [text(label), copyable(s)];
  }

  const head = s.slice(0, 600);
  const tail = s.slice(-200);

  return [
    text(label),
    text(`(truncated, ${s.length} characters)`),
    copyable(`${head}\n...\n${tail}`),
  ];
}

export function renderGetPublicKey(host, pubkey, chainName = 'Solaxy') {
  return snap.request({
    method: 'snap_dialog',
    params: {
      type: 'confirmation',
      content: panel([
        heading('Confirm public key access'),
        text(`Website: ${host}`),
        text(`Network: ${chainName}`),
        divider(),
        ...safeCopyable('Public key:', pubkey),
      ]),
    },
  });
}

export function renderSignTransaction(host, message, chainName = 'Solaxy') {
  return snap.request({
    method: 'snap_dialog',
    params: {
      type: 'confirmation',
      content: panel([
        heading('Sign transaction'),
        text(`Website: ${host}`),
        text(`Network: ${chainName}`),
        divider(),
        ...safeCopyable('Transaction (base58):', message),
      ]),
    },
  });
}

export function renderSignAllTransactions(host, messages, chainName = 'Solaxy') {
  if (messages.length === 1) {
    return renderSignTransaction(host, messages[0], chainName);
  }

  const ui = [
    heading('Sign transactions'),
    text(`Website: ${host}`),
    text(`Network: ${chainName}`),
  ];

  const count = messages.length;
  const shown = Math.min(count, MAX_BATCH_ITEMS);

  for (let i = 0; i < shown; i++) {
    ui.push(divider());
    ui.push(text(`Transaction ${i + 1} of ${count}`));
    ui.push(...safeCopyable('Transaction (base58):', messages[i]));
  }

  if (count > shown) {
    ui.push(divider());
    ui.push(text(`Note: Only the first ${shown} transactions are shown.`));
  }

  return snap.request({
    method: 'snap_dialog',
    params: {
      type: 'confirmation',
      content: panel(ui),
    },
  });
}

export function renderSignMessage(host, message, chainName = 'Solaxy') {
  return snap.request({
    method: 'snap_dialog',
    params: {
      type: 'confirmation',
      content: panel([
        heading('Sign message'),
        text(`Website: ${host}`),
        text(`Network: ${chainName}`),
        divider(),
        ...safeCopyable('Message:', message),
      ]),
    },
  });
}
