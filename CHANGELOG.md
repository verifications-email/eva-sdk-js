# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/verifications-email/eva-sdk-js/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/verifications-email/eva-sdk-js/releases/tag/v0.1.0
