import { EvaError } from './errors';
import { request } from './fetch';
import { pollBulkJob } from './polling';
import type {
  BatchResult,
  BulkJob,
  BulkJobResult,
  BulkUploadOptions,
  DomainDeliverability,
  EvaClientOptions,
  EvaResponse,
  PollOptions,
  RequestCallOptions,
  ResolvedConfig,
  VerificationResult,
} from './types';

/**
 * EVA Email Verification API client.
 *
 * @example
 * ```ts
 * import { EvaClient } from '@verifications-email/sdk';
 *
 * const eva = new EvaClient({ apiKey: 'eva_...' });
 * const { data, rateLimit } = await eva.verify('user@example.com');
 * console.log(data.risk, data.score, rateLimit.remaining);
 * ```
 */
export class EvaClient {
  private readonly config: ResolvedConfig;

  constructor(options: EvaClientOptions) {
    if (!options.apiKey) {
      throw new Error('apiKey is required');
    }
    this.config = {
      apiKey: options.apiKey,
      baseUrl: (options.baseUrl ?? 'https://verifications.email').replace(
        /\/$/,
        '',
      ),
      timeout: options.timeout ?? 30_000,
      maxRetries: options.maxRetries ?? 3,
      retryDelay: options.retryDelay ?? 1000,
      fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
    };
  }

  /**
   * Verify a single email address.
   *
   * @returns Full verification result with deliverability score, risk level,
   *          SMTP check, disposable/role/catch-all detection, and more.
   */
  async verify(
    email: string,
    options?: RequestCallOptions,
  ): Promise<EvaResponse<VerificationResult>> {
    return request<VerificationResult>(this.config, {
      method: 'POST',
      path: '/api/v1/verify',
      body: { email },
      signal: options?.signal,
    });
  }

  /**
   * Verify a batch of emails synchronously (up to 100).
   *
   * All emails are processed concurrently on the server.
   * Each email counts as one verification toward your quota.
   */
  async verifyBatch(
    emails: string[],
    options?: RequestCallOptions,
  ): Promise<EvaResponse<BatchResult>> {
    if (emails.length === 0) {
      throw new EvaError('At least one email is required', 'INVALID_INPUT', 400);
    }
    if (emails.length > 100) {
      throw new EvaError(
        'Batch size cannot exceed 100 emails',
        'INVALID_INPUT',
        400,
      );
    }
    return request<BatchResult>(this.config, {
      method: 'POST',
      path: '/api/v1/verify/batch',
      body: { emails },
      signal: options?.signal,
    });
  }

  /**
   * Upload a CSV or XLSX file for async bulk verification.
   *
   * The file must contain an email column (auto-detected: "email",
   * "email_address", or "e-mail"; falls back to first column).
   *
   * @param file - The file to upload (Blob, File, or Buffer).
   * @param options - Optional webhook URL, filename override, and abort signal.
   * @returns The created bulk job (status will be "pending").
   */
  async uploadBulk(
    file: Blob | ArrayBuffer | Uint8Array,
    options?: BulkUploadOptions,
  ): Promise<EvaResponse<BulkJob>> {
    const formData = new FormData();
    const filename = options?.filename ?? 'upload.csv';

    const blob =
      file instanceof Blob
        ? file
        : new Blob([file instanceof ArrayBuffer ? file : (file as Uint8Array<ArrayBuffer>)], {
            type: 'text/csv',
          });
    formData.append('file', blob, filename);

    if (options?.webhookUrl) {
      formData.append('webhook_url', options.webhookUrl);
    }

    return request<BulkJob>(this.config, {
      method: 'POST',
      path: '/api/v1/verify/async/upload',
      formData,
      signal: options?.signal,
    });
  }

  /** List all bulk jobs for the current API key. */
  async listBulkJobs(
    options?: RequestCallOptions,
  ): Promise<EvaResponse<BulkJob[]>> {
    return request<BulkJob[]>(this.config, {
      method: 'GET',
      path: '/api/v1/verify/async',
      signal: options?.signal,
    });
  }

  /** Get the status of a specific bulk job. */
  async getBulkJob(
    jobId: string,
    options?: RequestCallOptions,
  ): Promise<EvaResponse<BulkJob>> {
    return request<BulkJob>(this.config, {
      method: 'GET',
      path: `/api/v1/verify/async/${encodeURIComponent(jobId)}`,
      signal: options?.signal,
    });
  }

  /**
   * Get the results of a completed bulk job.
   *
   * @param jobId - The bulk job ID.
   * @param format - `"json"` (default) returns typed results, `"csv"` returns raw CSV string.
   */
  async getBulkJobResults(
    jobId: string,
    format?: 'json',
    options?: RequestCallOptions,
  ): Promise<EvaResponse<BulkJobResult[]>>;
  async getBulkJobResults(
    jobId: string,
    format: 'csv',
    options?: RequestCallOptions,
  ): Promise<string>;
  async getBulkJobResults(
    jobId: string,
    format: 'json' | 'csv' = 'json',
    options?: RequestCallOptions,
  ): Promise<EvaResponse<BulkJobResult[]> | string> {
    const path = `/api/v1/verify/async/${encodeURIComponent(jobId)}/result`;
    if (format === 'csv') {
      const result = await request<string>(this.config, {
        method: 'GET',
        path,
        query: { format: 'csv' },
        raw: true,
        signal: options?.signal,
      });
      return result.data;
    }
    return request<BulkJobResult[]>(this.config, {
      method: 'GET',
      path,
      signal: options?.signal,
    });
  }

  /**
   * Poll a bulk job until it completes or fails.
   *
   * @param jobId - The bulk job ID to poll.
   * @param options - Polling interval, timeout, progress callback, and abort signal.
   * @returns The final job state (completed or failed).
   *
   * @example
   * ```ts
   * const { data: job } = await eva.uploadBulk(csvFile);
   * const { data: done } = await eva.waitForBulkJob(job.id, {
   *   interval: 3000,
   *   onProgress: (j) => console.log(`${j.completed_count}/${j.total_count}`),
   * });
   * ```
   */
  async waitForBulkJob(
    jobId: string,
    options?: PollOptions,
  ): Promise<EvaResponse<BulkJob>> {
    return pollBulkJob(
      (id) => this.getBulkJob(id, { signal: options?.signal }),
      jobId,
      options,
    );
  }

  /**
   * Get a domain deliverability report.
   *
   * Checks SPF, DKIM, DMARC, MX records, and DNSBL blacklists.
   * Counts as one verification toward your quota.
   */
  async getDomainDeliverability(
    domain: string,
    options?: RequestCallOptions,
  ): Promise<EvaResponse<DomainDeliverability>> {
    return request<DomainDeliverability>(this.config, {
      method: 'GET',
      path: `/api/v1/domain/${encodeURIComponent(domain)}/deliverability`,
      signal: options?.signal,
    });
  }
}
