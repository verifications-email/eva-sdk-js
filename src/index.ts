// Client
export { EvaClient } from './client';

// Types
export type {
  EvaClientOptions,
  EvaResponse,
  RateLimitInfo,
  VerificationResult,
  BatchResult,
  BulkJob,
  BulkJobResult,
  BulkJobStatus,
  BulkUploadOptions,
  PollOptions,
  DomainDeliverability,
  DomainAuth,
  SPFResult,
  DKIMResult,
  DMARCResult,
  BlacklistResult,
  BlacklistEntry,
  Grade,
  Risk,
  SmtpCheck,
  SpamTrapRisk,
  BulkJobCompletedEvent,
  WebhookSummary,
  VerifyWebhookOptions,
  RequestCallOptions,
  ErrorCode,
} from './types';

// Errors
export {
  EvaError,
  RateLimitError,
  QuotaExceededError,
  AuthenticationError,
  NotFoundError,
  WebhookSignatureError,
} from './errors';

// Webhook utilities (standalone — no client instance needed)
export { verifyWebhookSignature, parseWebhookEvent } from './webhook';
