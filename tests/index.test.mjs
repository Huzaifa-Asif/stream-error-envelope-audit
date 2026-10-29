import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import esm, { createErrorEnvelopeAudit } from '../src/index.mjs';
const require = createRequire(import.meta.url);
const cjs = require('../src/index.cjs');

test('ESM and CommonJS expose the same API', () => assert.deepEqual(Object.keys(esm), Object.keys(cjs)));
test('accepts a nullable provider code without throwing', () => {
  const audit = createErrorEnvelopeAudit();
  const result = audit.observe({ type: 'error', error: { code: null, message: 'overloaded' } }, { status: 503 });
  assert.equal(result.normalized.retryClass, 'retryable');
  assert.equal(result.issues[0].code, 'missing-code');
});
test('unwraps nested gateway envelopes', () => {
  const result = createErrorEnvelopeAudit().observe({ data: { error: { code: 'rate_limit', type: 'provider_error', message: 'slow down' } } }, { status: 429, retryAfterMs: 500 });
  assert.deepEqual(result.normalized, { code: 'rate_limit', type: 'provider_error', message: 'slow down', status: 429, retryAfterMs: 500, explicitRetryable: null, partialOutput: false, sideEffectStarted: false, retryClass: 'retryable', statusSupplied: true });
});
test('marks terminal client errors non-retryable', () => assert.equal(createErrorEnvelopeAudit().normalize({ error: { message: 'bad key' }, status: 401 }).retryClass, 'non_retryable'));
test('does not recommend automatic retry after partial output or effects', () => {
  const audit = createErrorEnvelopeAudit();
  const result = audit.observe({ error: { code: 'overloaded', message: 'retry' } }, { status: 503, partialOutput: true, sideEffectStarted: true });
  assert.equal(result.normalized.retryClass, 'unknown');
  assert.deepEqual(result.issues.map(({ code }) => code), ['partial-output-retry-unsafe', 'side-effect-retry-unsafe']);
});
test('flags retry contradictions and excessive delays', () => {
  const result = createErrorEnvelopeAudit({ maxRetryAfterMs: 1000 }).observe({ error: { message: 'no', retryable: true, retryAfterMs: 5000 } }, { status: 403 });
  assert.deepEqual(result.issues.map(({ code }) => code), ['missing-code', 'retry-after-exceeds-budget', 'retry-contradiction']);
});
test('bounds text and does not retain original payloads', () => {
  const secret = { error: { code: 'x'.repeat(20), message: 'y'.repeat(20), secret: 'never retain' } };
  const normalized = createErrorEnvelopeAudit({ maxTextLength: 5 }).normalize(secret);
  assert.equal(normalized.code, 'xxxxx'); assert.equal(normalized.message, 'yyyyy'); assert.equal('secret' in normalized, false);
});
test('handles invalid and hostile objects conservatively', () => {
  const audit = createErrorEnvelopeAudit();
  assert.equal(audit.observe(null).issues[0].code, 'invalid-envelope');
  const hostile = { get error() { throw new Error('getter'); }, message: 'fallback' };
  assert.doesNotThrow(() => audit.observe(hostile));
});
test('captures stateful retryable getters once and retains only primitives', () => {
  let contextReads = 0;
  let envelopeReads = 0;
  const context = { get retryable() { contextReads += 1; return contextReads === 1 ? true : { secret: true }; } };
  const envelope = { error: { get retryable() { envelopeReads += 1; return envelopeReads === 1 ? false : { secret: true }; }, message: 'x' } };
  const normalized = createErrorEnvelopeAudit().normalize(envelope, context);
  assert.equal(normalized.explicitRetryable, true);
  assert.equal(contextReads, 1);
  assert.equal(envelopeReads, 1);
});
test('keeps ambiguous and invalid statuses unknown', () => {
  const audit = createErrorEnvelopeAudit();
  assert.equal(audit.normalize({ error: { message: 'x' } }, { status: 409 }).retryClass, 'non_retryable');
  assert.equal(audit.normalize({ error: { message: 'x' } }, { status: 501 }).retryClass, 'unknown');
  const invalid = audit.observe({ error: { message: 'x' } }, { status: 429.5 });
  assert.equal(invalid.normalized.retryClass, 'unknown');
  assert.equal(invalid.issues[0].code, 'invalid-status');
});
test('flags an explicit retry hint that conflicts with terminal 409 policy', () => {
  const result = createErrorEnvelopeAudit().observe({ error: { code: 'conflict', message: 'state conflict', retryable: true } }, { status: 409 });
  assert.equal(result.normalized.retryClass, 'non_retryable');
  assert.equal(result.issues.some(({ code }) => code === 'retry-contradiction'), true);
});
test('warnings do not invalidate an otherwise valid nullable-code envelope', () => {
  const audit = createErrorEnvelopeAudit();
  audit.observe({ error: { code: null, message: 'overloaded' } }, { status: 503 });
  const report = audit.finalize();
  assert.equal(report.valid, true);
  assert.equal(report.snapshot.warningIssueCount, 1);
  assert.equal(report.snapshot.errorIssueCount, 0);
});
test('enforces observation and diagnostic bounds', () => {
  const audit = createErrorEnvelopeAudit({ maxObservations: 1, maxIssues: 1 });
  audit.observe({});
  const limited = audit.observe({});
  assert.equal(limited.issues[0].code, 'observation-limit');
  assert.equal(limited.snapshot.droppedIssues, 2);
});
test('validates options and context', () => {
  assert.throws(() => createErrorEnvelopeAudit(null), /options/);
  assert.throws(() => createErrorEnvelopeAudit({ maxIssues: 0 }), /positive/);
  assert.equal(createErrorEnvelopeAudit().observe({}, null).issues[0].code, 'invalid-context');
});
test('finalize seals the audit and returns immutable evidence', () => {
  const audit = createErrorEnvelopeAudit();
  audit.observe({ error: { code: 'x', message: 'x' } }, { status: 500 });
  const report = audit.finalize();
  assert.equal(Object.isFrozen(report), true); assert.equal(Object.isFrozen(report.issues), true);
  assert.throws(() => audit.observe({}), /finalized/);
});
