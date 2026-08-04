import {
  EvaError,
  RateLimitError,
  QuotaExceededError,
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
      await sleep(delay + jitter);
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

    // Retryable? Only retry 429 and 5xx
    if (isRetryable(res.status) && attempt < config.maxRetries) {
      // For 429, respect Retry-After as a minimum wait
      if (res.status === 429 && rateLimit.retryAfter) {
        const serverWait = rateLimit.retryAfter * 1000;
        const ourWait =
          config.retryDelay * Math.pow(2, attempt) * (1 + Math.random() * 0.25);
        await sleep(Math.max(serverWait, ourWait));
      }
      continue;
    }

    // Non-retryable or exhausted retries — throw typed error
    throw toTypedError(res.status, errorMessage, errorCode, rateLimit);
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
): EvaError {
  switch (code) {
    case 'RATE_LIMITED':
      return new RateLimitError(message, rateLimit.retryAfter ?? 60, rateLimit);
    case 'QUOTA_EXCEEDED':
      return new QuotaExceededError(message, rateLimit);
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
