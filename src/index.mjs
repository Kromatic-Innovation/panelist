// @kromatic-innovation/plenum — public entrypoint.
//
// Extraction in progress (cwc#1320 S1): the engine is being ported from the
// internal persona-review skill. This entrypoint will re-export:
//   - registerPersonas / getPersonas / getRubric   (from ./lib/register.mjs)
//   - score                                          (from ./lib/score.mjs, cross-model)
//   - spawn                                          (the vote/comment/converse contract, #1263 slice E)
//   - the persona schema + drift-check
//
// Cross-model provider dispatch builds on PromptFoo/LiteLLM, not hand-rolled.
export const PLENUM_VERSION = "0.0.0";

export function registerPersonas() {
  throw new Error("plenum: engine port in progress (cwc#1320 S1). See PORTING.md.");
}
