# @verifications-email/sdk

Official JavaScript/TypeScript SDK for the **EVA Email Verification API**.

Zero dependencies. Works with Node.js 18+, Deno, Bun, and modern browsers.

## Installation

```bash
npm install @verifications-email/sdk
```

## Quick Start

```typescript
import { EvaClient } from '@verifications-email/sdk';

const eva = new EvaClient({ apiKey: 'eva_...' });

const { data, rateLimit } = await eva.verify('user@example.com');

console.log(data.score);        // 85
console.log(data.risk);         // "safe"
console.log(data.smtp_check);   // "deliverable"
console.log(data.is_disposable); // false
console.log(rateLimit.remaining); // 199
```

## Features

- Single email verification
- Batch verification (up to 100 emails)
- Async bulk file upload (CSV/XLSX) with polling
- Domain deliverability reports (SPF/DKIM/DMARC/blacklists)
- Webhook signature verification (HMAC-SHA256)
- Auto-retry with exponential backoff on 429/5xx (a used-up daily or monthly allowance is not retried)
- Rate limit info on every response
- Full TypeScript types

## API Reference

### Constructor

```typescript
const eva = new EvaClient({
  apiKey: 'eva_...',           // Required
  baseUrl: 'https://...',     // Default: 'https://verifications.email'
  timeout: 100_000,           // Request timeout in ms (default: 100s)
  maxRetries: 3,              // Retries on 429/5xx (default: 3)
  retryDelay: 1000,           // Base retry delay in ms (default: 1s)
});
```

### Single Verification

```typescript
const { data } = await eva.verify('user@gmail.com');

console.log(data.email);                  // "user@gmail.com"
console.log(data.score);                  // 0-100
console.log(data.risk);                   // "safe" | "risky" | "catchall" | "invalid" | "unknown"
console.log(data.smtp_check);             // "deliverable" | "undeliverable" | "risky" | "unknown"
console.log(data.is_disposable);          // false
console.log(data.is_role_account);        // false
console.log(data.is_catch_all);           // false
console.log(data.is_free_provider);       // true
console.log(data.spam_trap_risk);         // "low" | "medium" | "high"
console.log(data.suggested_correction);   // null or "gmail.com"
console.log(data.mx_records);             // ["aspmx.l.google.com", ...]
```

### Batch Verification

```typescript
const { data } = await eva.verifyBatch([
  'user1@gmail.com',
  'user2@company.com',
  'fake@disposable.xyz',
]);

console.log(data.total);   // 3
for (const result of data.results) {
  console.log(result.email, result.risk, result.score);
}
```

### Bulk File Upload + Polling

```typescript
import { readFileSync } from 'fs';

const csvFile = readFileSync('emails.csv');

// Upload the file
const { data: job } = await eva.uploadBulk(csvFile, {
  webhookUrl: 'https://myapp.com/webhook/eva', // optional
  filename: 'my-list.csv',                     // optional
});

console.log(job.id);     // "abc-123"
console.log(job.status); // "pending"

// Poll until complete
const { data: completed } = await eva.waitForBulkJob(job.id, {
  interval: 3000,  // poll every 3s (default: 5s)
  timeout: 300_000, // max wait 5min (default: 10min)
  onProgress: (j) => {
    console.log(`${j.completed_count}/${j.total_count} processed`);
  },
});

// Download results
const { data: results } = await eva.getBulkJobResults(completed.id);
for (const r of results) {
  console.log(r.email, r.risk, r.score);
}

// Or download as CSV
const csv = await eva.getBulkJobResults(completed.id, 'csv');
writeFileSync('results.csv', csv);
```

### Domain Deliverability

```typescript
const { data } = await eva.getDomainDeliverability('example.com');

console.log(data.score);                      // 85
console.log(data.grade);                      // "A"
console.log(data.authentication?.spf.found);  // true
console.log(data.authentication?.dkim.found); // true
console.log(data.authentication?.dmarc.policy); // "reject"
console.log(data.blacklist?.listed);          // false
```

### Bulk Job Management

```typescript
// List all jobs
const { data: jobs } = await eva.listBulkJobs();

// Get specific job status
const { data: job } = await eva.getBulkJob('job-id-123');
```

## Webhook Verification

Verify incoming webhook signatures without instantiating the client:

```typescript
import { verifyWebhookSignature, parseWebhookEvent } from '@verifications-email/sdk';
import type { BulkJobCompletedEvent } from '@verifications-email/sdk';

// Option 1: Verify only
const isValid = await verifyWebhookSignature({
  payload: rawBody,
  signature: req.headers['x-eva-signature'],
  secret: process.env.EVA_WEBHOOK_SECRET,
});

// Option 2: Verify + parse in one step
const event = await parseWebhookEvent<BulkJobCompletedEvent>({
  payload: rawBody,
  signature: req.headers['x-eva-signature'],
  secret: process.env.EVA_WEBHOOK_SECRET,
});

console.log(event.job_id);
console.log(event.summary); // { safe: 800, risky: 100, catchall: 50, invalid: 50, unknown: 12 }
```

### Express.js Example

```typescript
import express from 'express';
import { parseWebhookEvent } from '@verifications-email/sdk';
import type { BulkJobCompletedEvent } from '@verifications-email/sdk';

const app = express();

app.post('/webhook/eva', express.text({ type: '*/*' }), async (req, res) => {
  try {
    const event = await parseWebhookEvent<BulkJobCompletedEvent>({
      payload: req.body,
      signature: req.headers['x-eva-signature'] as string,
      secret: process.env.EVA_WEBHOOK_SECRET!,
    });

    console.log(`Job ${event.job_id} completed:`, event.summary);
    res.sendStatus(200);
  } catch (err) {
    console.error('Invalid webhook:', err);
    res.sendStatus(401);
  }
});
```

## Error Handling

All API errors are thrown as typed error classes:

```typescript
import {
  EvaClient,
  EvaError,
  RateLimitError,
  QuotaExceededError,
  AuthenticationError,
  NotFoundError,
} from '@verifications-email/sdk';

const eva = new EvaClient({ apiKey: 'eva_...' });

try {
  const { data } = await eva.verify('test@example.com');
} catch (err) {
  if (err instanceof RateLimitError) {
    // Per-minute rate limit hit — wait and retry
    console.log(`Rate limited. Retry after ${err.retryAfter}s`);
    console.log(`Remaining: ${err.rateLimit?.remaining}`);
  } else if (err instanceof QuotaExceededError) {
    // Monthly quota exhausted, no PAYG credits left
    console.log('Quota exceeded. Purchase credit packs to continue.');
  } else if (err instanceof EvaError && err.code === 'PAID_PLAN_REQUIRED') {
    // Free account without credits: API access needs a plan or a credit
    // pack. Its 300 free checks run in the dashboard.
    console.log('Pick a plan or a credit pack to use the API.');
  } else if (err instanceof AuthenticationError) {
    // Invalid or missing API key
    console.log('Check your API key');
  } else if (err instanceof NotFoundError) {
    // Resource not found (e.g., invalid bulk job ID)
    console.log('Not found');
  } else if (err instanceof EvaError) {
    // Other API error
    console.log(err.message, err.code, err.status);
  }
}
```

## Rate Limit Info

Every response includes rate limit data:

```typescript
const { data, rateLimit } = await eva.verify('user@example.com');

console.log(rateLimit.limit);             // 200 (per-minute limit)
console.log(rateLimit.remaining);         // 199
console.log(rateLimit.reset);             // Date object
console.log(rateLimit.creditsRemaining);  // null or number (PAYG credits)
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | — | **Required.** Your EVA API key. |
| `baseUrl` | `string` | `https://verifications.email` | API base URL. |
| `timeout` | `number` | `100000` | Request timeout (ms). A check can take up to 90 s when the mail server holds its reply. |
| `maxRetries` | `number` | `3` | Max retries on 429/5xx errors. `DAILY_LIMIT` and `QUOTA_EXCEEDED` are never retried, and no single wait is longer than 60 s. |
| `retryDelay` | `number` | `1000` | Base delay (ms) for exponential backoff. |
| `fetch` | `function` | `globalThis.fetch` | Custom fetch implementation. |

## Runtime Support

| Runtime | Version | Notes |
|---------|---------|-------|
| Node.js | >= 18 | Native `fetch` and `crypto.subtle` |
| Deno | >= 1.28 | Full support |
| Bun | >= 1.0 | Full support |
| Browsers | Modern | Chrome 63+, Firefox 57+, Safari 11.1+ |

## Changes

### Unreleased

- A 429 with `DAILY_LIMIT` or `QUOTA_EXCEEDED` is no longer retried: it throws `DailyLimitError` or `QuotaExceededError` at once instead of waiting out a `Retry-After` that can be most of a day. `RATE_LIMITED` is still retried, with each wait capped at 60 s.
- Added `DAILY_LIMIT` to `ErrorCode`.
- Added `PAID_PLAN_REQUIRED` to `ErrorCode`. A Free account without credits gets 403 `PAID_PLAN_REQUIRED` from every API call, thrown at once as `EvaError` with that code; any plan or credit pack lifts it.

### 0.3.0

- Removed `yahoo_api_verified`, `yahoo_api_error`, `entra_gct_verified` and `entra_gct_error` from `VerificationResult`. They were undocumented diagnostics that never changed a verdict; the score and `reason` already carry what they said. Existing clients that read them get `undefined`.
- Added `is_locked` to `VerificationResult` and `BulkJobResult`: the provider reported the account locked (temporary or permanent lockout).

## License

MIT
