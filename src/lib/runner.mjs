// runner.mjs — the generic agentic persona runner (panelist#4 slice E, decision D5).
//
// D5 (resolved): ONE generic runner rendered from the register at call time —
// NOT 22 static per-persona agent files. The register (register.mjs) stays the
// single identity source of truth; this module just keys the existing spawn
// contract by persona id so an agentic caller (or the `.claude/agents/persona.md`
// subagent) can say "run persona X on this task" without any per-persona code.
//
// D4 (resolved, unaffected by this file): BOTH execution planes stay — the
// programmatic high-fan-out plane (score.mjs: score/scoreCandidate) and the
// agentic single-turn plane (spawn.mjs: spawn). This module is a thin front
// door onto the agentic plane only; it does not touch score.mjs.
//
// This module is intentionally thin: it DELEGATES to getPersona (register.mjs)
// and buildSpawnPrompt/spawn (spawn.mjs) rather than reimplementing any of
// their logic. If you find yourself duplicating prompt-building or contract
// logic here, stop — call the existing function instead.

import { getPersona } from "./register.mjs";
import { spawn, buildSpawnPrompt } from "./spawn.mjs";

/**
 * Render the subagent prompt for ANY registered persona, by id — the
 * "{record}+{task} -> subagent prompt" renderer that makes the agentic plane
 * generic. Delegates persona lookup to getPersona and prompt rendering to
 * buildSpawnPrompt; does not reimplement either.
 *
 * @param {string} personaId
 * @param {object} task
 *   @param {"vote"|"comment"|"converse"} task.mode
 *   @param {string|object} task.artifact
 *   @param {string} [task.instruction]
 *   @param {object} [task.responseSchema]
 *   @param {string} [task.horizon]
 *   @param {string[]} [task.tools]  explicit tool allowlist (panelist#72), forwarded to spawn.
 *   @param {string} [task.model]  per-call model tier (panelist#113), forwarded to spawn. Like
 *     task.tools, it does NOT change the rendered prompt — the output is byte-identical with or
 *     without it (see the NOTE below). Takes precedence over the persona's own `modelTier`
 *     (panelist#119) when the persona record carries one.
 * @param {object} [deps]
 *   @param {function} [deps.buildPrompt]  override buildSpawnPrompt, same convention as spawn.
 * @returns {string} the rendered subagent prompt
 */
export function renderRunnerPrompt(personaId, task = {}, deps = {}) {
  const persona = getPersona(personaId);
  if (!persona) {
    throw new Error(`panelist runner: unknown persona ${JSON.stringify(personaId)} — register it first.`);
  }
  const build = deps.buildPrompt || buildSpawnPrompt;
  const { mode, artifact, instruction, responseSchema, horizon } = task;
  return build({ persona, mode, artifact, instruction, responseSchema, horizon });
}

// NOTE: task.tools (panelist#72) does not change the RENDERED PROMPT above —
// tool isolation is enforced by spawn's gate (isolation.mjs), not by prompt
// wording. renderRunnerPrompt stays prompt-text-only, same as before.
// task.model (panelist#113) is the same class of field: it is execution-shaping
// (which model tier runs the call), not prompt-shaping, so the destructure above
// deliberately omits it and the rendered prompt is byte-identical with or without
// task.model. It flows through runPersona -> spawn -> client.complete, never here.
// persona.modelTier (panelist#119, register-carried default) is the same class
// again: resolved in spawn.mjs alongside task.model (per-call wins), never read
// here, and never part of the rendered prompt (it is also absent from
// PERSONA_FIELDS, so renderPersona/renderRunnerPrompt can't see it either way).

/**
 * The generic agentic runner (D5): resolve a persona by id and run it for one
 * turn. This is the ONE runner that handles ANY registered persona — it
 * delegates entirely to spawn(), which already resolves the persona, builds
 * the prompt, calls the injected client, and returns the invocation-contract
 * wrapper. No per-persona code lives here or anywhere else.
 *
 * @param {string} personaId
 * @param {object} task            same shape as spawn's opts: { mode, artifact, instruction?, responseSchema?, horizon?, tools?, model? }
 *   @param {string} [task.model]  per-call model tier (panelist#113); forwarded to spawn for
 *     free (this delegates wholesale), which passes it opaquely to client.complete. Omit to
 *     fall back to the persona's own `modelTier` (panelist#119), if the register carries one,
 *     then to the injected adapter's own model if neither is set.
 * @param {object} [deps]
 *   @param {{model,complete}} [deps.client]  injected model client (default throws, same as spawn).
 *   @param {object} [deps.toolGate]          share a gate (isolation.mjs createToolGate) across a panel.
 *   @param {function} [deps.buildPrompt]     override buildSpawnPrompt.
 * @returns {Promise<{ personaId, mode, verdict: object|null, message: string, dealKillers: string[], isolation: { tools: string[], denied: object[] } }>}
 */
export async function runPersona(personaId, task = {}, deps = {}) {
  return spawn(personaId, task, deps);
}
