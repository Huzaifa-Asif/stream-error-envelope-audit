'use strict';

function positiveInteger(value, name, fallback) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive safe integer`);
  return value;
}

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function own(value, key) { return object(value) && Object.prototype.hasOwnProperty.call(value, key); }
function safeRead(value, key) { try { return own(value, key) ? value[key] : undefined; } catch { return undefined; } }
function text(value, limit) { return typeof value === 'string' && value.length > 0 ? value.slice(0, limit) : null; }
function number(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function httpStatus(value) { return Number.isSafeInteger(value) && value >= 100 && value <= 599 ? value : null; }

function createErrorEnvelopeAudit(options = {}) {
  if (!object(options)) throw new TypeError('options must be an object');
  const maxObservations = positiveInteger(options.maxObservations, 'maxObservations', 10_000);
  const maxIssues = positiveInteger(options.maxIssues, 'maxIssues', 1_000);
  const maxTextLength = positiveInteger(options.maxTextLength, 'maxTextLength', 512);
  const maxRetryAfterMs = positiveInteger(options.maxRetryAfterMs, 'maxRetryAfterMs', 120_000);
  const issues = [];
  const counts = { retryable: 0, non_retryable: 0, unknown: 0 };
  let observations = 0;
  let totalIssues = 0;
  let errorIssues = 0;
  let warningIssues = 0;
  let droppedIssues = 0;
  let finalized = false;

  function retain(code, message, detail = {}, severity = 'error') {
    totalIssues += 1;
    if (severity === 'warning') warningIssues += 1; else errorIssues += 1;
    const issue = Object.freeze({ code, severity, observation: observations, message, ...detail });
    if (issues.length < maxIssues) issues.push(issue); else droppedIssues += 1;
    return issue;
  }

  function findEnvelope(raw) {
    if (!object(raw)) return null;
    const direct = safeRead(raw, 'error');
    if (object(direct)) return direct;
    const data = safeRead(raw, 'data');
    const nested = safeRead(data, 'error');
    return object(nested) ? nested : raw;
  }

  function normalize(raw, context = {}) {
    if (!object(context)) throw new TypeError('context must be an object');
    const envelope = findEnvelope(raw);
    if (!envelope) return null;
    const contextStatus = safeRead(context, 'status');
    const rawStatus = safeRead(raw, 'status');
    const envelopeStatus = envelope === raw ? rawStatus : safeRead(envelope, 'status');
    const suppliedStatus = contextStatus ?? rawStatus ?? envelopeStatus;
    const status = httpStatus(suppliedStatus);
    const contextRetryable = safeRead(context, 'retryable');
    const envelopeRetryable = safeRead(envelope, 'retryable');
    const explicitRetryable = typeof contextRetryable === 'boolean'
      ? contextRetryable
      : (typeof envelopeRetryable === 'boolean' ? envelopeRetryable : null);
    const contextRetryAfter = safeRead(context, 'retryAfterMs');
    const envelopeRetryAfter = safeRead(envelope, 'retryAfterMs');
    const rawRetryAfter = number(contextRetryAfter) ?? number(envelopeRetryAfter);
    const retryAfterMs = rawRetryAfter !== null && rawRetryAfter >= 0 ? rawRetryAfter : null;
    const codeValue = safeRead(envelope, 'code');
    const code = typeof codeValue === 'string' || typeof codeValue === 'number' ? String(codeValue).slice(0, maxTextLength) : null;
    const type = text(safeRead(envelope, 'type'), maxTextLength);
    const envelopeMessage = safeRead(envelope, 'message');
    const rawMessage = envelope === raw ? envelopeMessage : safeRead(raw, 'message');
    const message = text(envelopeMessage, maxTextLength) ?? text(rawMessage, maxTextLength);
    const partialOutput = safeRead(context, 'partialOutput') === true;
    const sideEffectStarted = safeRead(context, 'sideEffectStarted') === true;
    let retryClass = 'unknown';
    if (explicitRetryable === true || [408, 425, 429, 502, 503, 504].includes(status)) retryClass = 'retryable';
    if (explicitRetryable === false || (status !== null && status >= 400 && status <= 499 && ![408, 425, 429].includes(status))) retryClass = 'non_retryable';
    if (partialOutput || sideEffectStarted) retryClass = 'unknown';
    return Object.freeze({ code, type, message, status, retryAfterMs, explicitRetryable, partialOutput, sideEffectStarted, retryClass, statusSupplied: suppliedStatus !== undefined && suppliedStatus !== null });
  }

  function snapshot() {
    return Object.freeze({ observations, counts: Object.freeze({ ...counts }), issueCount: totalIssues, errorIssueCount: errorIssues, warningIssueCount: warningIssues, retainedIssueCount: issues.length, droppedIssues, finalized });
  }

  function observe(raw, context = {}) {
    if (finalized) throw new Error('audit is finalized');
    if (observations >= maxObservations) return Object.freeze({ status: 'rejected', normalized: null, issues: Object.freeze([retain('observation-limit', 'observation would exceed maxObservations', { limit: maxObservations })]), snapshot: snapshot() });
    observations += 1;
    let normalized;
    try { normalized = normalize(raw, context); }
    catch (error) { return Object.freeze({ status: 'rejected', normalized: null, issues: Object.freeze([retain('invalid-context', error.message)]), snapshot: snapshot() }); }
    if (!normalized) return Object.freeze({ status: 'rejected', normalized: null, issues: Object.freeze([retain('invalid-envelope', 'error envelope must be a non-array object')]), snapshot: snapshot() });
    counts[normalized.retryClass] += 1;
    const found = [];
    if (normalized.statusSupplied && normalized.status === null) found.push(retain('invalid-status', 'status must be an integer from 100 through 599'));
    if (normalized.code === null) found.push(retain('missing-code', 'error code is absent or null; classification remains evidence-based', {}, 'warning'));
    if (normalized.message === null) found.push(retain('missing-message', 'error message is absent', {}, 'warning'));
    if (normalized.retryAfterMs !== null && normalized.retryAfterMs > maxRetryAfterMs) found.push(retain('retry-after-exceeds-budget', 'retry delay exceeds configured budget', { retryAfterMs: normalized.retryAfterMs, limit: maxRetryAfterMs }));
    if (normalized.explicitRetryable === true && normalized.status !== null && normalized.status >= 400 && normalized.status < 500 && ![408, 425, 429].includes(normalized.status)) found.push(retain('retry-contradiction', 'explicit retryable flag conflicts with a normally terminal client status', { status: normalized.status }));
    if (normalized.partialOutput) found.push(retain('partial-output-retry-unsafe', 'automatic retry is unsafe after partial output without application reconciliation'));
    if (normalized.sideEffectStarted) found.push(retain('side-effect-retry-unsafe', 'automatic retry is unsafe after a side effect may have started'));
    return Object.freeze({ status: 'accepted', normalized, issues: Object.freeze(found), snapshot: snapshot() });
  }

  function finalize() {
    finalized = true;
    return Object.freeze({ valid: errorIssues === 0, issues: Object.freeze([...issues]), snapshot: snapshot() });
  }

  return Object.freeze({ observe, normalize, snapshot, finalize });
}

module.exports = { createErrorEnvelopeAudit };
