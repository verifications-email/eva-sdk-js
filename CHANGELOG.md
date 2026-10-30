# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] - 2026-10-30

### Added

- `DailyLimitError` for `429 DAILY_LIMIT`: a Free plan account without credits has used its
  checks for the day. It carries `retryAfter`, `limit` and `remaining`, and is never retried.

### Changed

- The default request timeout is 100 seconds (was 30). A mail server that holds its answer can
  make a single check take up to 90 seconds, and a shorter timeout cut those checks off.
- `429 DAILY_LIMIT` and `429 QUOTA_EXCEEDED` are no longer retried, and no wait between retries
  is longer than 60 seconds, whatever `Retry-After` says.

## [0.3.0] - 2026-10-14

### Added

- `reason` on every result: why the verdict landed where it did (`catch_all`, `no_mx`,
  `greylisted`, ...).
- `is_locked` on single and bulk results: the provider reported the account locked.
- `catchall` and `unknown` risk values, and their counts in bulk job summaries.

### Removed

- `catch_all_confidence` and the provider-specific diagnostic fields of the result.

## [0.1.0] - 2026-08-05

First public release.

### Added

- `EvaClient` with single-address verification (`verify`) and batch verification of up to
  100 addresses (`verifyBatch`)
- Async bulk verification: CSV/XLSX upload, job status, results, and a polling helper
- Domain deliverability reports (SPF, DKIM, DMARC, blacklists)
- Webhook helpers: `verifyWebhookSignature` (HMAC-SHA256) and `parseWebhookEvent`
- Automatic retry with exponential backoff on 429 and 5xx responses
- Rate-limit state returned alongside the data on every call
- Full TypeScript types, ESM and CommonJS builds, no runtime dependencies

[Unreleased]: https://github.com/verifications-email/eva-sdk-js/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/verifications-email/eva-sdk-js/compare/v0.1.0...v0.4.0
[0.3.0]: https://www.npmjs.com/package/@verifications-email/sdk/v/0.3.0
[0.1.0]: https://github.com/verifications-email/eva-sdk-js/releases/tag/v0.1.0
