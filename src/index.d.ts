export type RetryClass = 'retryable' | 'non_retryable' | 'unknown';
export interface ErrorContext { readonly status?: number; readonly retryable?: boolean; readonly retryAfterMs?: number; readonly partialOutput?: boolean; readonly sideEffectStarted?: boolean; }
export interface NormalizedError { readonly code: string | null; readonly type: string | null; readonly message: string | null; readonly status: number | null; readonly retryAfterMs: number | null; readonly explicitRetryable: boolean | null; readonly partialOutput: boolean; readonly sideEffectStarted: boolean; readonly retryClass: RetryClass; readonly statusSupplied: boolean; }
export interface AuditIssue { readonly code: string; readonly severity: 'warning' | 'error'; readonly observation: number; readonly message: string; readonly [key: string]: unknown; }
export interface AuditSnapshot { readonly observations: number; readonly counts: Readonly<Record<RetryClass, number>>; readonly issueCount: number; readonly errorIssueCount: number; readonly warningIssueCount: number; readonly retainedIssueCount: number; readonly droppedIssues: number; readonly finalized: boolean; }
export interface ObserveResult { readonly status: 'accepted' | 'rejected'; readonly normalized: NormalizedError | null; readonly issues: readonly AuditIssue[]; readonly snapshot: AuditSnapshot; }
export interface ErrorEnvelopeAudit { observe(raw: unknown, context?: ErrorContext): ObserveResult; normalize(raw: unknown, context?: ErrorContext): NormalizedError | null; snapshot(): AuditSnapshot; finalize(): { readonly valid: boolean; readonly issues: readonly AuditIssue[]; readonly snapshot: AuditSnapshot }; }
export interface ErrorEnvelopeAuditOptions { readonly maxObservations?: number; readonly maxIssues?: number; readonly maxTextLength?: number; readonly maxRetryAfterMs?: number; }
export declare function createErrorEnvelopeAudit(options?: ErrorEnvelopeAuditOptions): ErrorEnvelopeAudit;
declare const api: { createErrorEnvelopeAudit: typeof createErrorEnvelopeAudit };
export default api;
