// @kromatic-innovation/plenum — public entrypoint.
//
// A synthetic persona panel that tells you where readers quit. Compose a registry
// from packs (or your own records), then score() a candidate across a cross-model
// panel, or spawn() a single persona for a vote/comment/converse turn. No live
// provider is bundled — inject a client/panel (mock in tests; PromptFoo/LiteLLM
// adapter in production).
//
// Ported from the internal persona-review skill (cwc#1320 S1). The v2 schema
// (plenum#2) is landed; the agentic entry point (plenum#4: spawn + the generic
// runner) is now landing too. A live PromptFoo/LiteLLM provider and full
// honesty guardrails (plenum#6) remain later slices.
export const PLENUM_VERSION = "0.0.0";

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

// Drift-check (repo-scoped record validation).
export { checkRecords, scanRepo as driftScanRepo, formatReport as formatDriftReport } from "./lib/drift-check.mjs";
