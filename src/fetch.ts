import {
  EvaError,
  RateLimitError,
  QuotaExceededError,
  DailyLimitError,
  AuthenticationError,
  NotFoundError,
} from './errors';
import type { EvaResponse, RateLimitInfo, ResolvedConfig } from './types';

/** @internal */
export interface RequestOptions {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  formData?: FormData;
  query?: Record<string, string>;
  raw?: boolean;
  signal?: AbortSignal;
}

function intOrNull(value: string | null): number | null {
  if (value === null) return null;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
}

function parseRateLimit(headers: Headers): RateLimitInfo {
  const resetRaw = headers.get('X-RateLimit-Reset');
  return {
    limit: intOrNull(headers.get('X-RateLimit-Limit')),
    remaining: intOrNull(headers.get('X-RateLimit-Remaining')),
    reset: resetRaw ? new Date(parseInt(resetRaw, 10) * 1000) : null,
    retryAfter: intOrNull(headers.get('Retry-After')),
    creditsRemaining: intOrNull(headers.get('X-Credits-Remaining')),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * 429 codes no retry can fix: the day's or the month's allowance is used up,
 * and Retry-After can be most of a day away.
 */
const NON_RETRYABLE_429_CODES = new Set(['DAILY_LIMIT', 'QUOTA_EXCEEDED']);

/** @internal Longest single wait between retries, whatever Retry-After says. */
export const MAX_RETRY_SLEEP_MS = 60_000;

/** @internal The wait before retrying a 429 that carried Retry-After. */
export function retryAfterWait(
  retryAfterSeconds: number,
  attempt: number,
  retryDelay: number,
): number {
  const serverWait = retryAfterSeconds * 1000;
  const ourWait =
    retryDelay * Math.pow(2, attempt) * (1 + Math.random() * 0.25);
  return Math.min(Math.max(serverWait, ourWait), MAX_RETRY_SLEEP_MS);
}

/** @internal Core request function with retry logic. */
export async function request<T>(
  config: ResolvedConfig,
  options: RequestOptions,
): Promise<EvaResponse<T>> {
  const url = buildUrl(config.baseUrl, options.path, options.query);

  const headers: Record<string, string> = {
    'X-API-Key': config.apiKey,
    Accept: 'application/json',
  };

  let fetchBody: BodyInit | undefined;

  if (options.formData) {
    fetchBody = options.formData;
    // Let the runtime set Content-Type with boundary for multipart
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    fetchBody = JSON.stringify(options.body);
  }

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = config.retryDelay * Math.pow(2, attempt - 1);
      const jitter = delay * Math.random() * 0.25;
      await sleep(Math.min(delay + jitter, MAX_RETRY_SLEEP_MS));
    }

    // Combine user-provided signal with per-request timeout
    const timeoutSignal = AbortSignal.timeout(config.timeout);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;

    let res: Response;
    try {
      res = await config.fetch(url, {
        method: options.method,
        headers,
        body: fetchBody,
        signal,
      });
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < config.maxRetries) continue;
      throw lastError;
    }

    const rateLimit = parseRateLimit(res.headers);

    // Success
    if (res.ok) {
      if (options.raw) {
        const text = await res.text();
        return { data: text as unknown as T, rateLimit, response: res };
      }
      const json = (await res.json()) as { data: T };
      return { data: json.data, rateLimit, response: res };
    }

    // Parse error body
    let errorMessage = 'Request failed';
    let errorCode = 'INTERNAL_ERROR';
    try {
      const body = (await res.json()) as { error?: string; code?: string };
      if (body.error) errorMessage = body.error;
      if (body.code) errorCode = body.code;
    } catch {
      // Body wasn't JSON — use defaults
    }

    // Retryable? Only retry 429 and 5xx, and never a used-up allowance
    const retryable =
      isRetryable(res.status) &&
      !(res.status === 429 && NON_RETRYABLE_429_CODES.has(errorCode));
    if (retryable && attempt < config.maxRetries) {
      // For 429, respect Retry-After as a minimum wait, up to MAX_RETRY_SLEEP_MS
      if (res.status === 429 && rateLimit.retryAfter) {
        await sleep(retryAfterWait(rateLimit.retryAfter, attempt, config.retryDelay));
      }
      continue;
    }

    // Non-retryable or exhausted retries — throw typed error
    throw toTypedError(res.status, errorMessage, errorCode, rateLimit, res.headers);
  }

  // Should never reach here, but satisfy TypeScript
  throw lastError ?? new Error('Request failed');
}

function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string>,
): string {
  const url = new URL(path, baseUrl);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

function toTypedError(
  status: number,
  message: string,
  code: string,
  rateLimit: RateLimitInfo,
  headers: Headers,
): EvaError {
  switch (code) {
    case 'RATE_LIMITED':
      return new RateLimitError(message, rateLimit.retryAfter ?? 60, rateLimit);
    case 'QUOTA_EXCEEDED':
      return new QuotaExceededError(message, rateLimit);
    case 'DAILY_LIMIT':
      return new DailyLimitError(
        message,
        rateLimit,
        intOrNull(headers.get('X-Daily-Limit')),
        intOrNull(headers.get('X-Daily-Remaining')),
      );
    case 'UNAUTHORIZED':
      return new AuthenticationError(message);
    case 'NOT_FOUND':
      return new NotFoundError(message);
    default:
      return new EvaError(
        message,
        code as EvaError['code'],
        status,
        rateLimit,
      );
  }
}
