const ERR_INVALID_INPUT = {
  code: -32000,
  message: 'Invalid input.',
};

const ERR_USER_REJECTED = {
  code: 4001,
  message: 'User rejected the request.',
};

// SECURITY: Input validation limits to prevent DoS attacks
// MAX_ARRAY_LENGTH: Prevents excessive batch operations (e.g., signAllTransactions)
// MAX_STRING_LENGTH: Prevents memory exhaustion from oversized inputs
const MAX_ARRAY_LENGTH = 100;
const MAX_STRING_LENGTH = 10_000;

export function assertInput(input) {
  if (input === null || input === undefined) {
    throw ERR_INVALID_INPUT;
  }
}

export function assertAllStrings(input) {
  if (
    !Array.isArray(input) ||
    input.length > MAX_ARRAY_LENGTH ||
    !input.every(
      (item) =>
        typeof item === 'string' && item.length <= MAX_STRING_LENGTH,
    )
  ) {
    throw ERR_INVALID_INPUT;
  }
}

export function assertIsArray(input) {
  if (!Array.isArray(input) || input.length > MAX_ARRAY_LENGTH) {
    throw ERR_INVALID_INPUT;
  }
}

export function assertIsString(input) {
  if (typeof input !== 'string' || input.length > MAX_STRING_LENGTH) {
    throw ERR_INVALID_INPUT;
  }
}

export function assertIsBoolean(input) {
  if (typeof input !== 'boolean') {
    throw ERR_INVALID_INPUT;
  }
}

export function assertConfirmation(confirmed) {
  if (confirmed !== true) {
    throw ERR_USER_REJECTED;
  }
}
