// panelist — public entrypoint.
//
// A synthetic persona panel that tells you where readers quit. Compose a registry
// from packs (or your own records), then score() a candidate across a cross-model
// panel, or spawn() a single persona for a vote/comment/converse turn. No live
// provider is bundled — inject a client/panel (mock in tests; PromptFoo/LiteLLM
// adapter in production).
//
// Ported from the internal persona-review skill. The v2 schema
// (panelist#2) is landed; the agentic entry point (panelist#4: spawn + the generic
// runner) and the calibration harness (panelist#5: synthetic vs real signal) are
// landed too. Full honesty guardrails (panelist#6) are now landing: every panel
// output is auto-stamped with the honesty caveat by construction (score.mjs),
// formatPanelSummary leads with verdict/deal-killers (never a warmth score),
// and drift-check gains a checkHonesty guardrail, exercised in CI by the
// test suite (test/honesty-gate.test.mjs) over real plane outputs, so no
// summary can silently omit the caveat. A live PromptFoo/LiteLLM provider
// remains a later slice.
export const PANELIST_VERSION = "0.4.0";

// Registry — compose personas/rubrics at runtime.
export {
  registerPersonas,
  registerRubric,
  getPersona,
  getPersonas,
  getRubric,
  getUsage,
  clearRegistry,
} from "./lib/register.mjs";

// Cross-model scoring.
export {
  score,
  scoreCandidate,
  rankCandidatesWith,
  createLimiter,
  normalizeRubric,
  decideVerdict,
  extractScore,
  extractJsonObject,
  buildEvalPrompt,
  renderPersona,
  providerOf,
} from "./lib/score.mjs";

// Single-turn invocation contract.
export { spawn, buildSpawnPrompt } from "./lib/spawn.mjs";

// Generic agentic runner (D5) — one runner, any registered persona, rendered
// from the register at call time.
export { renderRunnerPrompt, runPersona } from "./lib/runner.mjs";

// Multi-turn junction contract (slice 1) — the generic junction-graph + loop-runner
// primitive underneath jauss's hub-and-spoke walk and a linear blog-engagement judge.
// Reveals one junction at a time behind a structural information barrier.
export { runJunctionLoop, BAIL } from "./lib/junction.mjs";

// Junction contract (slice 2) — the generic reaction/decision schema, run-level trace
// builder, and cross-run aggregation. Engine emits mechanics; consumers own
// interpretation via runJunctionLoop's onComplete hook.
export {
  ENGAGEMENT,
  REACTION_KEYS,
  TRACE_KEYS,
  deriveEngagement,
  normalizeEngagement,
  reactionFrom,
  buildTrace,
  aggregateJunctionTraces,
} from "./lib/junction-schema.mjs";

// Calibration harness (D6, deferred by design) — join synthetic verdicts to
// an injected real downstream signal; no analytics provider is bundled.
export { calibratePersonas, spearmanRankCorrelation, keptSetHitRate } from "./lib/calibrate.mjs";

// Schema.
export {
  SCHEMA_VERSION,
  USAGE_HEADER,
  PERSONA_SCHEMA,
  PERSONA_FIELDS,
  REQUIRED_FIELDS,
  FORBIDDEN_FIELDS,
  validatePersona,
  isPersonaShaped,
} from "./lib/schema.mjs";

// Drift-check (repo-scoped record validation + honesty-stamp guardrail).
// checkHonesty is the batch guardrail: not called by drift-check's own
// CLI/main() (which scans repo records, not panel summaries) — it is
// invoked in CI by test/honesty-gate.test.mjs over real plane outputs.
export {
  checkRecords,
  scanRepo as driftScanRepo,
  formatReport as formatDriftReport,
  checkHonesty,
} from "./lib/drift-check.mjs";

// Honesty guardrails (panelist#6) — auto-stamp + assert the honesty caveat on
// every panel output; formatPanelSummary leads with verdict/deal-killers.
export { stampHonesty, formatPanelSummary, assertHonestyStamped, HONESTY_MARKER } from "./lib/honesty.mjs";

// Tool isolation (panelist#72) — deny persona tools by default; the deny/allow
// decision as an independently testable unit. spawn()/runPersona() build a
// gate from this internally; these are exported for callers assembling a
// multi-persona panel (e.g. sharing one gate, or accumulating per-call
// isolation.tools into a panel-level record — the effective set the verdict
// was produced under, not a union across differentiated reviewers).
export {
  DISCOVERY_TOOLS,
  resolveEffectiveTools,
  isToolGranted,
  recordDenial,
  createToolGate,
  buildIsolationEnvelope,
  unionTools,
} from "./lib/isolation.mjs";
