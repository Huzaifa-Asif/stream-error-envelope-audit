# stream-error-envelope-audit

Normalize and audit decoded provider or gateway error envelopes without losing the evidence needed for a safe retry decision. The package is deterministic, bounded, zero-dependency, and ships ESM, CommonJS, and TypeScript entry points.

It **does not retry requests**, parse SSE bytes, contact a provider, or promise that a retry is safe.

## Why

Streaming systems frequently deliver errors through several shapes: a direct error object, an `error` event, or a gateway's `data.error` wrapper. A valid provider code may be null, while status, retry delay, and partial-output state still matter. Rejecting such an envelope as malformed can hide the original failure; blindly retrying can duplicate output or side effects.

The package was motivated by current public integration reports:

- [Vercel AI #21360](https://github.com/vercel/ai/issues/21360) (2026-09-22): a valid Responses error with `code: null` was rejected by a schema and obscured an upstream retryable 500.
- [Vercel AI #18303](https://github.com/vercel/ai/issues/18303) (2026-07-31): gateway streaming surfaced a validation error instead of preserving the upstream provider error context.
- [Vercel AI #22671](https://github.com/vercel/ai/issues/22671) (2026-10-10): callers need failure-aware control over retries, including privacy-sensitive metadata decisions.
- [Vercel AI #23762](https://github.com/vercel/ai/issues/23762) (2026-10-21): callback timing could skip an expected stream retry, demonstrating that classification and retry execution should remain observable and separate.

This is an independent package and is not affiliated with Vercel or any model provider.

## Install

```sh
npm install stream-error-envelope-audit
```

Node.js 20 or newer is supported.

## Quick start

```js
import { createErrorEnvelopeAudit } from 'stream-error-envelope-audit';

const audit = createErrorEnvelopeAudit({ maxRetryAfterMs: 30_000 });
const result = audit.observe(
  { type: 'error', error: { code: null, message: 'provider overloaded' } },
  { status: 503, retryAfterMs: 1_000, partialOutput: false },
);

if (result.normalized.retryClass === 'retryable' &&
    !result.issues.some(({ severity }) => severity === 'error') &&
    applicationPolicyAllowsRetry(result.normalized)) {
  scheduleRetry(result.normalized.retryAfterMs);
}
```

CommonJS:

```js
const { createErrorEnvelopeAudit } = require('stream-error-envelope-audit');
```

## API

### `createErrorEnvelopeAudit(options?)`

- `maxObservations` (default `10_000`) bounds processed envelopes.
- `maxIssues` (default `1_000`) bounds retained diagnostics.
- `maxTextLength` (default `512`) truncates copied code, type, and message strings.
- `maxRetryAfterMs` (default `120_000`) marks delays beyond an application budget.

### `audit.observe(raw, context?)`

Recognizes a direct object, `raw.error`, or `raw.data.error`. Context may contain:

- `status`: HTTP-like numeric status.
- `retryable`: explicit caller or adapter hint.
- `retryAfterMs`: already-parsed delay in milliseconds.
- `partialOutput`: output was exposed before the failure.
- `sideEffectStarted`: a tool or other side effect may have begun.

The immutable normalized result includes bounded `code`, `type`, and `message` strings plus `retryClass`: `retryable`, `non_retryable`, or `unknown`. The conservative built-in retryable status set is 408, 425, 429, 502, 503, and 504; an explicit boolean hint can override it. Other 5xx statuses remain unknown. Partial output or a possible side effect always reduces the class to `unknown`; the package never asserts idempotency.

### `audit.normalize(raw, context?)`

Normalizes without incrementing counts or retaining diagnostics. It returns `null` for a non-object envelope.

### `audit.snapshot()` and `audit.finalize()`

Snapshots report bounded counters only. `finalize()` seals the audit and returns retained issues. `valid` means no error-severity diagnostic occurred; warning-only metadata gaps such as a nullable code remain valid. Source payloads, headers, stack traces, and arbitrary fields are never retained.

## Diagnostics

- warning: `missing-code` and `missing-message`
- error: `invalid-status`
- `retry-after-exceeds-budget`
- `retry-contradiction`
- `partial-output-retry-unsafe`
- `side-effect-retry-unsafe`
- `invalid-envelope`, `invalid-context`, and `observation-limit`

## Limitations

- Classification uses status and explicit hints; it cannot know a provider's complete retry contract.
- It does not parse `Retry-After` header strings. Parse and validate them at your HTTP boundary.
- It does not retain response bodies or headers, deduplicate retries, calculate backoff, or execute a retry.
- `retryable` means the envelope contains retry evidence, not that replay is safe. Idempotency, billing, privacy, partial output, and side effects remain application decisions.
- Hostile getters are treated as missing fields; the package cannot make arbitrary proxy objects safe.

## Alternatives

- Provider SDK retry logic is preferable when its semantics and telemetry meet your needs.
- [`p-retry`](https://www.npmjs.com/package/p-retry) and [`async-retry`](https://www.npmjs.com/package/async-retry) execute retry policies; this package only audits decoded evidence.
- [`ai-stream-auditor`](https://www.npmjs.com/package/ai-stream-auditor) validates OpenAI/Anthropic event lifecycles and terminal outcomes; it does not normalize arbitrary gateway error envelopes.
- `stream-part-lifecycle`, `stream-sequence-fence`, and `abort-settlement-audit` cover keyed parts, ordering/replay, and cancellation settlement respectively—not error-shape preservation.

## Troubleshooting

- `missing-code`: do not reject the event solely because code is null; use other evidence.
- `retry-contradiction`: stop automatic retry and inspect the adapter/provider contract.
- `partial-output-retry-unsafe`: reconcile displayed or persisted output before any replay.
- `side-effect-retry-unsafe`: require an idempotency key or manual decision.
- `retry-after-exceeds-budget`: fail or defer according to your latency budget.

## Security and privacy

Pass only already-decoded error metadata. Do not include secrets in messages or codes. See [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).
