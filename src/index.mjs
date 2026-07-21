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
// and drift-check gains a checkHonesty guardrail so CI can assert no summary
// omits the caveat. A live PromptFoo/LiteLLM provider remains a later slice.
export const PANELIST_VERSION = "0.1.1";

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
export {
  checkRecords,
  scanRepo as driftScanRepo,
  formatReport as formatDriftReport,
  checkHonesty,
} from "./lib/drift-check.mjs";

// Honesty guardrails (panelist#6) — auto-stamp + assert the honesty caveat on
// every panel output; formatPanelSummary leads with verdict/deal-killers.
export { stampHonesty, formatPanelSummary, assertHonestyStamped, HONESTY_MARKER } from "./lib/honesty.mjs";
