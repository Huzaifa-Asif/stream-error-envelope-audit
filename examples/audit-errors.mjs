import { createErrorEnvelopeAudit } from '../src/index.mjs';

const audit = createErrorEnvelopeAudit({ maxRetryAfterMs: 30_000 });
const result = audit.observe(
  { type: 'error', error: { code: null, message: 'provider overloaded', retryable: true } },
  { status: 503, retryAfterMs: 1_000, partialOutput: false },
);
console.log(JSON.stringify({ retryClass: result.normalized.retryClass, issues: result.issues.map(({ code }) => code) }));
