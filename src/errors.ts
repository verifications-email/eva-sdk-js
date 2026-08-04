import type { ErrorCode, RateLimitInfo } from './types';

/**
 * Base error for all EVA API errors.
 *
 * Check the `code` property for a machine-readable error code,
 * and `status` for the HTTP status.
 */
export class EvaError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly rateLimit: RateLimitInfo | null;

  constructor(
    message: string,
    code: ErrorCode,
    status: number,
    rateLimit?: RateLimitInfo,
  ) {
    super(message);
    this.name = 'EvaError';
    this.code = code;
    this.status = status;
    this.rateLimit = rateLimit ?? null;
  }
}

/**
 * Thrown when per-minute rate limit is exceeded (429 RATE_LIMITED).
 *
 * Use `retryAfter` to know how long to wait before retrying.
 */
export class RateLimitError extends EvaError {
  readonly retryAfter: number;

  constructor(message: string, retryAfter: number, rateLimit: RateLimitInfo) {
    super(message, 'RATE_LIMITED', 429, rateLimit);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

/**
 * Thrown when monthly quota is exhausted and no PAYG credits remain (429 QUOTA_EXCEEDED).
 *
 * The user needs to purchase credit packs or wait for the next billing cycle.
 */
export class QuotaExceededError extends EvaError {
  constructor(message: string, rateLimit: RateLimitInfo) {
    super(message, 'QUOTA_EXCEEDED', 429, rateLimit);
    this.name = 'QuotaExceededError';
  }
}

/** Thrown when the API key is missing or invalid (401). */
export class AuthenticationError extends EvaError {
  constructor(message: string = 'Invalid or missing API key') {
    super(message, 'UNAUTHORIZED', 401);
    this.name = 'AuthenticationError';
  }
}

/** Thrown when the requested resource is not found (404). */
export class NotFoundError extends EvaError {
  constructor(message: string = 'Resource not found') {
    super(message, 'NOT_FOUND', 404);
    this.name = 'NotFoundError';
  }
}

/** Thrown when webhook signature verification fails. */
export class WebhookSignatureError extends Error {
  constructor(message: string = 'Invalid webhook signature') {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}
