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
- Auto-retry with exponential backoff on 429/5xx
- Rate limit info on every response
- Full TypeScript types

## API Reference

### Constructor

```typescript
const eva = new EvaClient({
  apiKey: 'eva_...',           // Required
  baseUrl: 'https://...',     // Default: 'https://verifications.email'
  timeout: 30_000,            // Request timeout in ms (default: 30s)
  maxRetries: 3,              // Retries on 429/5xx (default: 3)
  retryDelay: 1000,           // Base retry delay in ms (default: 1s)
});
```

### Single Verification

```typescript
const { data } = await eva.verify('user@gmail.com');

console.log(data.email);                  // "user@gmail.com"
console.log(data.score);                  // 0-100
console.log(data.risk);                   // "safe" | "risky" | "invalid"
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
console.log(event.summary); // { safe: 800, risky: 150, invalid: 50 }
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
| `timeout` | `number` | `30000` | Request timeout (ms). |
| `maxRetries` | `number` | `3` | Max retries on 429/5xx errors. |
| `retryDelay` | `number` | `1000` | Base delay (ms) for exponential backoff. |
| `fetch` | `function` | `globalThis.fetch` | Custom fetch implementation. |

## Runtime Support

| Runtime | Version | Notes |
|---------|---------|-------|
| Node.js | >= 18 | Native `fetch` and `crypto.subtle` |
| Deno | >= 1.28 | Full support |
| Bun | >= 1.0 | Full support |
| Browsers | Modern | Chrome 63+, Firefox 57+, Safari 11.1+ |

## License

MIT
