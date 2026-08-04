/**
 * Live integration test for @eva-email/sdk
 * Uses the test API key from project config.
 * Run: node test-live.mjs
 */

import { EvaClient, EvaError, RateLimitError } from './dist/index.js';

const API_KEY = process.env.EVA_API_KEY;
if (!API_KEY) {
  console.error('Set EVA_API_KEY to run live tests.');
  process.exit(1);
}
const BASE_URL = process.env.EVA_BASE_URL || 'http://eva-api:8080';

const eva = new EvaClient({
  apiKey: API_KEY,
  baseUrl: BASE_URL,
  timeout: 20_000,
  maxRetries: 1,
});

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.log(`  FAIL: ${label}`);
    failed++;
  }
}

// ── Test 1: Single email verification ──────────────────────────
console.log('\n[Test 1] Single email verification (POST /api/v1/verify)');
try {
  const { data, rateLimit } = await eva.verify('test@gmail.com');
  assert(typeof data.email === 'string', 'email is string');
  assert(typeof data.score === 'number', 'score is number');
  assert(['safe', 'risky', 'invalid'].includes(data.risk), `risk is valid enum: "${data.risk}"`);
  assert(['deliverable', 'undeliverable', 'risky', 'unknown'].includes(data.smtp_check), `smtp_check is valid: "${data.smtp_check}"`);
  assert(typeof data.syntax_valid === 'boolean', 'syntax_valid is boolean');
  assert(typeof data.mx_found === 'boolean', 'mx_found is boolean');
  assert(typeof data.is_disposable === 'boolean', 'is_disposable is boolean');
  assert(typeof data.is_role_account === 'boolean', 'is_role_account is boolean');
  assert(typeof data.is_catch_all === 'boolean', 'is_catch_all is boolean');
  assert(typeof data.is_free_provider === 'boolean', 'is_free_provider is boolean');
  assert(Array.isArray(data.mx_records), 'mx_records is array');
  assert(rateLimit.limit !== null, `rateLimit.limit = ${rateLimit.limit}`);
  assert(rateLimit.remaining !== null, `rateLimit.remaining = ${rateLimit.remaining}`);
  assert(rateLimit.reset instanceof Date, 'rateLimit.reset is Date');
  console.log(`  Score: ${data.score}, Risk: ${data.risk}, SMTP: ${data.smtp_check}`);
} catch (err) {
  console.log(`  ERROR: ${err.message}`);
  failed++;
}

// ── Test 2: Verify invalid syntax email ────────────────────────
console.log('\n[Test 2] Invalid email syntax');
try {
  const { data } = await eva.verify('not-an-email');
  assert(data.syntax_valid === false, 'syntax_valid is false for invalid email');
  assert(data.risk === 'invalid', `risk is "invalid": "${data.risk}"`);
} catch (err) {
  // Some APIs reject this at the handler level with 400
  if (err instanceof EvaError && err.status === 400) {
    console.log(`  PASS: API returned 400 for invalid email (expected)`);
    passed++;
  } else {
    console.log(`  ERROR: ${err.message}`);
    failed++;
  }
}

// ── Test 3: Verify disposable email ────────────────────────────
console.log('\n[Test 3] Disposable email detection');
try {
  const { data } = await eva.verify('test@mailinator.com');
  assert(data.is_disposable === true, 'mailinator detected as disposable');
  console.log(`  Score: ${data.score}, Disposable: ${data.is_disposable}`);
} catch (err) {
  console.log(`  ERROR: ${err.message}`);
  failed++;
}

// ── Test 4: Batch verification ─────────────────────────────────
console.log('\n[Test 4] Batch verification (POST /api/v1/verify/batch)');
try {
  const { data } = await eva.verifyBatch([
    'test@gmail.com',
    'fake@nonexistent-domain-xyz123.com',
  ]);
  assert(data.total === 2, `total is 2: ${data.total}`);
  assert(Array.isArray(data.results), 'results is array');
  assert(data.results.length === 2, `results length is 2: ${data.results.length}`);
  for (const r of data.results) {
    assert(typeof r.email === 'string', `result has email: ${r.email}`);
    assert(typeof r.score === 'number', `result has score: ${r.score}`);
  }
} catch (err) {
  console.log(`  ERROR: ${err.message}`);
  failed++;
}

// ── Test 5: Client-side batch validation ───────────────────────
console.log('\n[Test 5] Client-side batch limit validation');
try {
  await eva.verifyBatch([]);
  console.log('  FAIL: Should have thrown for empty array');
  failed++;
} catch (err) {
  assert(err instanceof EvaError, 'throws EvaError for empty batch');
  assert(err.code === 'INVALID_INPUT', `code is INVALID_INPUT: "${err.code}"`);
}

try {
  const tooMany = Array.from({ length: 101 }, (_, i) => `test${i}@example.com`);
  await eva.verifyBatch(tooMany);
  console.log('  FAIL: Should have thrown for >100 emails');
  failed++;
} catch (err) {
  assert(err instanceof EvaError, 'throws EvaError for >100 batch');
  assert(err.code === 'INVALID_INPUT', `code is INVALID_INPUT: "${err.code}"`);
}

// ── Test 6: Domain deliverability ──────────────────────────────
console.log('\n[Test 6] Domain deliverability (GET /api/v1/domain/:domain/deliverability)');
try {
  const { data } = await eva.getDomainDeliverability('gmail.com');
  assert(data.domain === 'gmail.com', `domain is gmail.com: "${data.domain}"`);
  assert(typeof data.score === 'number', `score is number: ${data.score}`);
  assert(['A', 'B', 'C', 'D', 'F'].includes(data.grade), `grade is valid: "${data.grade}"`);
  assert(data.has_mx === true, 'gmail.com has MX');
  assert(data.authentication?.spf?.found === true, 'gmail.com has SPF');
  console.log(`  Score: ${data.score}, Grade: ${data.grade}`);
} catch (err) {
  console.log(`  ERROR: ${err.message}`);
  failed++;
}

// ── Test 7: Invalid API key ────────────────────────────────────
console.log('\n[Test 7] Authentication error with invalid API key');
try {
  const badClient = new EvaClient({
    apiKey: 'eva_invalid_key_here',
    baseUrl: BASE_URL,
    maxRetries: 0,
  });
  await badClient.verify('test@gmail.com');
  console.log('  FAIL: Should have thrown AuthenticationError');
  failed++;
} catch (err) {
  assert(err instanceof EvaError, 'throws EvaError');
  assert(err.status === 401, `status is 401: ${err.status}`);
  assert(err.code === 'UNAUTHORIZED', `code is UNAUTHORIZED: "${err.code}"`);
}

// ── Test 8: List bulk jobs ─────────────────────────────────────
console.log('\n[Test 8] List bulk jobs (GET /api/v1/verify/async)');
try {
  const { data } = await eva.listBulkJobs();
  assert(Array.isArray(data), 'returns array');
  console.log(`  Found ${data.length} bulk jobs`);
  passed++;
} catch (err) {
  console.log(`  ERROR: ${err.message}`);
  failed++;
}

// ── Test 9: Get non-existent bulk job ──────────────────────────
console.log('\n[Test 9] Get non-existent bulk job (404)');
try {
  await eva.getBulkJob('00000000-0000-0000-0000-000000000000');
  console.log('  FAIL: Should have thrown NotFoundError');
  failed++;
} catch (err) {
  assert(err instanceof EvaError, 'throws EvaError');
  assert(err.status === 404, `status is 404: ${err.status}`);
}

// ── Summary ────────────────────────────────────────────────────
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(50)}`);
process.exit(failed > 0 ? 1 : 0);
