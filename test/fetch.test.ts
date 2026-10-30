import { test } from 'node:test';
import assert from 'node:assert/strict';

import { request, retryAfterWait, MAX_RETRY_SLEEP_MS } from '../src/fetch.ts';
import {
  DailyLimitError,
  QuotaExceededError,
  RateLimitError,
} from '../src/errors.ts';
import type { ResolvedConfig } from '../src/types.ts';

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** A config whose fetch answers from `responses` in order and counts calls. */
function fakeConfig(responses: Response[]): { config: ResolvedConfig; calls: () => number } {
  let n = 0;
  const fetchFn = (async () => {
    const res = responses[Math.min(n, responses.length - 1)];
    n++;
    return res.clone();
  }) as typeof globalThis.fetch;
  return {
    config: {
      apiKey: 'eva_test',
      baseUrl: 'https://example.test',
      timeout: 5_000,
      maxRetries: 3,
      retryDelay: 1,
      fetch: fetchFn,
    },
    calls: () => n,
  };
}

test('DAILY_LIMIT is not retried and throws DailyLimitError', async () => {
  const { config, calls } = fakeConfig([
    jsonResponse(
      429,
      { error: 'The Free plan allows 50 checks a day.', code: 'DAILY_LIMIT' },
      { 'Retry-After': '86000', 'X-Daily-Limit': '50', 'X-Daily-Remaining': '5' },
    ),
  ]);
  const started = Date.now();
  await assert.rejects(
    request(config, { method: 'POST', path: '/api/v1/verify/batch', body: { emails: [] } }),
    (err: unknown) => {
      assert.ok(err instanceof DailyLimitError);
      assert.equal(err.code, 'DAILY_LIMIT');
      assert.equal(err.status, 429);
      assert.equal(err.retryAfter, 86000);
      assert.equal(err.limit, 50);
      assert.equal(err.remaining, 5);
      return true;
    },
  );
  assert.equal(calls(), 1, 'a used-up day must not be retried');
  assert.ok(Date.now() - started < 1_000, 'must not wait for Retry-After');
});

test('QUOTA_EXCEEDED is not retried and throws QuotaExceededError', async () => {
  const { config, calls } = fakeConfig([
    jsonResponse(
      429,
      { error: 'monthly quota exceeded', code: 'QUOTA_EXCEEDED' },
      { 'Retry-After': '86000' },
    ),
  ]);
  await assert.rejects(
    request(config, { method: 'GET', path: '/api/v1/verify', query: { email: 'a@b.com' } }),
    (err: unknown) => err instanceof QuotaExceededError && err.code === 'QUOTA_EXCEEDED',
  );
  assert.equal(calls(), 1);
});

test('RATE_LIMITED is still retried, then throws RateLimitError', async () => {
  const limited = jsonResponse(429, { error: 'rate limit exceeded', code: 'RATE_LIMITED' });
  const { config, calls } = fakeConfig([limited]);
  await assert.rejects(
    request(config, { method: 'GET', path: '/api/v1/verify', query: { email: 'a@b.com' } }),
    (err: unknown) => err instanceof RateLimitError,
  );
  assert.equal(calls(), config.maxRetries + 1);
});

test('RATE_LIMITED then success returns the data', async () => {
  const { config, calls } = fakeConfig([
    jsonResponse(429, { error: 'rate limit exceeded', code: 'RATE_LIMITED' }),
    jsonResponse(200, { data: { email: 'a@b.com', risk: 'safe' } }),
  ]);
  const res = await request<{ email: string; risk: string }>(config, {
    method: 'GET',
    path: '/api/v1/verify',
    query: { email: 'a@b.com' },
  });
  assert.equal(res.data.risk, 'safe');
  assert.equal(calls(), 2);
});

test('a long Retry-After never stalls a retry past MAX_RETRY_SLEEP_MS', () => {
  assert.equal(MAX_RETRY_SLEEP_MS, 60_000);
  assert.equal(retryAfterWait(86_400, 0, 1000), MAX_RETRY_SLEEP_MS);
  assert.equal(retryAfterWait(86_400, 5, 1000), MAX_RETRY_SLEEP_MS);
  const short = retryAfterWait(2, 0, 1000);
  assert.ok(short >= 2_000 && short <= MAX_RETRY_SLEEP_MS, `got ${short}`);
});
