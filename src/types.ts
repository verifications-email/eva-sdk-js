// ─── Configuration ─────────────────────────────────────────────

export interface EvaClientOptions {
  /** API key (starts with `eva_`) */
  apiKey: string;
  /** Base URL of the EVA API. Default: `https://verifications.email` */
  baseUrl?: string;
  /** Request timeout in milliseconds. Default: `30000` */
  timeout?: number;
  /** Max automatic retries on 429/5xx. Default: `3` */
  maxRetries?: number;
  /** Base delay between retries in ms (exponential backoff). Default: `1000` */
  retryDelay?: number;
  /** Custom fetch implementation (for testing or polyfills). */
  fetch?: typeof globalThis.fetch;
}

/** @internal Resolved config with defaults applied. */
export interface ResolvedConfig {
  apiKey: string;
  baseUrl: string;
  timeout: number;
  maxRetries: number;
  retryDelay: number;
  fetch: typeof globalThis.fetch;
}

/** Per-request options passed to individual client methods. */
export interface RequestCallOptions {
  /** AbortSignal to cancel the request. */
  signal?: AbortSignal;
}

// ─── Response Wrapper ──────────────────────────────────────────

/** Every SDK method returns this wrapper. */
export interface EvaResponse<T> {
  /** The parsed response payload. */
  data: T;
  /** Rate limit information from response headers. */
  rateLimit: RateLimitInfo;
  /** The raw fetch Response for advanced use. */
  response: Response;
}

export interface RateLimitInfo {
  /** Requests allowed per minute. */
  limit: number | null;
  /** Requests remaining in current window. */
  remaining: number | null;
  /** When the rate limit window resets. */
  reset: Date | null;
  /** Seconds to wait before retrying (from Retry-After header). */
  retryAfter: number | null;
  /** PAYG credits remaining (only present when credits were deducted). */
  creditsRemaining: number | null;
}

// ─── Verification ──────────────────────────────────────────────

export type Risk = 'safe' | 'risky' | 'invalid';
export type SmtpCheck = 'deliverable' | 'undeliverable' | 'risky' | 'unknown';
export type SpamTrapRisk = 'low' | 'medium' | 'high';

export interface VerificationResult {
  email: string;
  /** Composite deliverability score (0–100). */
  score: number;
  risk: Risk;
  syntax_valid: boolean;
  mx_found: boolean;
  smtp_check: SmtpCheck;
  is_disposable: boolean;
  is_role_account: boolean;
  is_catch_all: boolean;
  /** Catch-all confidence (0–100) when is_catch_all is true, otherwise null. */
  catch_all_confidence: number | null;
  is_free_provider: boolean;
  spam_trap_risk: SpamTrapRisk;
  /** Suggested domain correction (e.g. "gmail.com" for "gmial.com"), or null. */
  suggested_correction: string | null;
  /** Domain reputation score (0–100), or null. */
  domain_reputation_score: number | null;
  /** MX hostnames for the domain. */
  mx_records: string[];
  /** Full domain deliverability analysis, or null. */
  deliverability: DomainDeliverability | null;
  /** Detected SMTP provider (e.g. "Gmail", "Microsoft 365"). */
  smtp_provider?: string | null;
  is_disabled?: boolean;
  is_full_inbox?: boolean;
  is_tarpitted?: boolean;
  /** SMTP response time in milliseconds. */
  response_latency_ms?: number;
  /** SMTP banner provider string. */
  banner_provider?: string | null;
  is_default_catch_all?: boolean;
  /** Double Bounce Email Box detection. */
  is_dbeb?: boolean;
  is_accept_all?: boolean;
  /** Yahoo API verification was used. */
  yahoo_api_verified?: boolean;
  yahoo_api_error?: string | null;
  /** Microsoft Entra GetCredentialType verification was used. */
  entra_gct_verified?: boolean;
  entra_gct_error?: string | null;
}

// ─── Batch ─────────────────────────────────────────────────────

export interface BatchResult {
  total: number;
  results: VerificationResult[];
}

// ─── Bulk Jobs ─────────────────────────────────────────────────

export type BulkJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface BulkJob {
  id: string;
  api_key_id: string;
  status: BulkJobStatus;
  total_count: number;
  completed_count: number;
  file_url?: string;
  result_url?: string;
  webhook_url?: string;
  created_at: string;
  completed_at: string | null;
}

export interface BulkJobResult {
  email: string;
  score: number;
  risk: Risk;
  smtp_check: SmtpCheck;
  is_disposable: boolean;
  is_role_account: boolean;
  is_catch_all: boolean;
  is_free_provider: boolean;
  spam_trap_risk: SpamTrapRisk;
  domain_reputation_score: number | null;
  suggested_correction: string | null;
}

export interface BulkUploadOptions {
  /** HTTPS URL to receive a webhook when the job completes. */
  webhookUrl?: string;
  /** Override the filename in the multipart upload. Default: `"upload.csv"` */
  filename?: string;
  /** AbortSignal to cancel the upload. */
  signal?: AbortSignal;
}

export interface PollOptions {
  /** Milliseconds between status polls. Default: `5000` */
  interval?: number;
  /** Maximum total wait time in milliseconds. Default: `600000` (10 min) */
  timeout?: number;
  /** Called after each poll with the current job state. */
  onProgress?: (job: BulkJob) => void;
  /** AbortSignal to cancel polling. */
  signal?: AbortSignal;
}

// ─── Domain Deliverability ─────────────────────────────────────

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface SPFResult {
  found: boolean;
  record?: string;
  strictness?: 'strict' | 'moderate' | 'permissive' | 'none';
}

export interface DKIMResult {
  found: boolean;
  selectors?: string[];
}

export interface DMARCResult {
  found: boolean;
  record?: string;
  policy?: 'reject' | 'quarantine' | 'none';
}

export interface DomainAuth {
  spf: SPFResult;
  dkim: DKIMResult;
  dmarc: DMARCResult;
}

export interface BlacklistEntry {
  zone: string;
  ip: string;
}

export interface BlacklistResult {
  listed: boolean;
  listed_count: number;
  total_checks: number;
  listings?: BlacklistEntry[];
}

export interface DomainDeliverability {
  domain: string;
  /** Overall deliverability score (0–100). */
  score: number;
  grade: Grade;
  authentication?: DomainAuth;
  blacklist?: BlacklistResult;
  has_mx: boolean;
  reputation_score: number | null;
  checked_at: string;
}

// ─── Webhook Events ────────────────────────────────────────────

export interface WebhookSummary {
  safe: number;
  risky: number;
  invalid: number;
}

export interface BulkJobCompletedEvent {
  event: 'bulk_job.completed';
  job_id: string;
  status: string;
  total_count: number;
  completed_count: number;
  summary: WebhookSummary;
  result_url: string;
  timestamp: string;
}

export interface VerifyWebhookOptions {
  /** Raw request body (string or bytes). */
  payload: string | BufferSource;
  /** Value of the `X-EVA-Signature` header. */
  signature: string;
  /** Your webhook signing secret. */
  secret: string;
}

// ─── Error Codes ───────────────────────────────────────────────

export type ErrorCode =
  | 'INVALID_INPUT'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'QUOTA_EXCEEDED'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR';
