// spawn.mjs — the persona invocation contract (#1263 slice E).
//
//   spawn(personaId, { mode, artifact, instruction, responseSchema?, horizon?, tools?, model? }, deps)
//     -> { personaId, mode, verdict|null, message, dealKillers[], isolation }
//
// One persona, one turn, one wrapper. This is the FOUNDATIONAL single-turn
// contract; the richer agentic/converse plane (multi-turn dialogue, tool use) is
// a later slice (panelist#4). Here, every mode resolves to a single model call:
//
//   mode "vote"     — render a judgement. `verdict` is filled IFF a responseSchema
//                     is supplied (the schema describes the verdict shape).
//   mode "comment"  — free-text critique. verdict stays null.
//   mode "converse" — a single conversational reply. verdict stays null.
//
// Invariants:
//   - `message`     is ALWAYS free text (the persona's own words).
//   - `verdict`     is non-null ONLY when responseSchema was supplied.
//   - `dealKillers` is ALWAYS an array (possibly empty) — a persona may always
//     surface blocking objections regardless of mode. (Full honesty-guardrail
//     auto-stamping is panelist#6; this just keeps the wrapper caveat-capable.)
//   - `isolation`   is ALWAYS present (panelist#72): { tools, denied }. `tools`
//     defaults to `[]` — spawn grants NO tools unless opts.tools names them
//     explicitly (see isolation.mjs; wildcard grants throw). `denied` reports
//     attempted-but-denied tool calls rather than swallowing them.
//
// The model client is INJECTED (deps.client), the same adapter shape score.mjs
// uses: { model, complete: async ({prompt, maxTokens, temperature, tools}) =>
// { ok, text, model, deniedToolCalls? } }. No live provider is bundled; the
// default throws. An adapter that actually dispatches tool calls is expected to
// consult the injected gate (deps.toolGate, or build one itself against the
// same `tools` allowlist) before calling one, and MAY additionally report
// attempted-but-denied calls back via `res.deniedToolCalls` (array of tool id
// strings, or `{ tool, at }` objects) — spawn merges those into `isolation.denied`.
//
// Model tier resolution (panelist#113 + panelist#119, companion to cwc#1879):
// most specific wins — opts.model (explicit per-call) beats persona.modelTier
// (an optional, register-carried default set on the persona record) beats
// leaving the `model` key off entirely (inherit the injected adapter's own
// model — today's behavior). `persona.modelTier` is opaque, unvalidated, and
// execution-shaping only: it is never read by buildSpawnPrompt, so the
// rendered prompt is byte-identical with or without it, same as opts.model.

import { getPersona } from "./register.mjs";
import { renderPersona, extractJsonObject, fenceArtifact } from "./score.mjs";
import { createToolGate, buildIsolationEnvelope, normalizeReportedDenial } from "./isolation.mjs";
import { stampHonesty } from "./honesty.mjs";

const MODES = new Set(["vote", "comment", "converse"]);

// DEFAULT_MAX_TOKENS/DEFAULT_TEMPERATURE (panelist#85, PAN-09): named, and now
// overridable via deps.maxTokens/deps.temperature (see spawn below). 1024 is
// deliberately looser than score.mjs's SCORE_MAX_TOKENS (512) — spawn produces
// a free-text persona reaction, not a fixed small JSON score object — a
// divergence that is a product decision explicitly deferred by #85, not an
// oversight to unify here.
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TEMPERATURE = 0;

/** The default client: refuses to run, forcing an explicit injection. */
const throwingClient = {
  model: "none",
  async complete() {
    throw new Error(
      "panelist spawn: inject a client (deps.client: { model, complete }). " +
        "No live provider is bundled — pass a mock in tests, or a PromptFoo/LiteLLM adapter in production.",
    );
  },
};

function modeInstruction(mode, hasSchema) {
  switch (mode) {
    case "vote":
      return hasSchema
        ? "Render your judgement of the artifact AS THIS PERSONA. Fill `verdict` per the response schema below, and `message` with a one-paragraph rationale in your own voice."
        : "Render your judgement of the artifact AS THIS PERSONA in `message`, in your own voice.";
    case "comment":
      return "Give your candid critique of the artifact AS THIS PERSONA in `message`. Do not vote; just react.";
    case "converse":
      return "Respond to the artifact/instruction AS THIS PERSONA in `message`, as one conversational turn.";
    default:
      return "Respond AS THIS PERSONA in `message`.";
  }
}

/**
 * Build the single-turn prompt handed to the client.
 * @returns {string}
 */
export function buildSpawnPrompt({ persona, mode, artifact, instruction, responseSchema, horizon }) {
  const hasSchema = responseSchema != null;
  const artifactText =
    artifact == null
      ? ""
      : typeof artifact === "string"
        ? artifact
        : typeof artifact.text === "string"
          ? artifact.text
          : JSON.stringify(artifact);

  const contractFields = [
    hasSchema ? '"verdict": <per the response schema above>' : null,
    '"message": "<your reaction, in your own voice>"',
    '"dealKillers": ["<blocking objection>", ...]  // [] if none',
  ]
    .filter(Boolean)
    .join(",\n  ");

  return [
    "You are role-playing a specific persona reacting to an artifact. Judge ONLY as this persona would — their concerns, not yours.",
    "",
    renderPersona(persona),
    "",
    modeInstruction(mode, hasSchema),
    instruction ? `\nADDITIONAL INSTRUCTION: ${instruction}` : "",
    horizon ? `TIME HORIZON: ${horizon}` : "",
    "",
    "ARTIFACT UNDER REVIEW:",
    fenceArtifact(artifactText),
    "",
    hasSchema ? `RESPONSE SCHEMA for verdict:\n${JSON.stringify(responseSchema)}` : "",
    "",
    "Reply with ONLY a JSON object (no prose, no markdown fences):",
    `{\n  ${contractFields}\n}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Coerce a parsed dealKillers value into a clean string array. */
function normalizeDealKillers(v) {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim());
}

/**
 * Invoke one persona for a single turn.
 *
 * @param {string} personaId
 * @param {object} opts
 *   @param {"vote"|"comment"|"converse"} opts.mode
 *   @param {string|object} opts.artifact
 *   @param {string} [opts.instruction]
 *   @param {object} [opts.responseSchema]  when present, `verdict` is filled.
 *   @param {string} [opts.horizon]
 *   @param {string[]} [opts.tools]  explicit tool allowlist (panelist#72). Omit for none —
 *     spawn is fully isolated by default. No wildcards; see isolation.mjs.
 *   @param {string} [opts.model]  per-call model tier (panelist#113), forwarded opaquely to
 *     client.complete. Omit to inherit the injected adapter's own model — omitted means the
 *     `model` key is left OFF the complete() argument entirely, not set to undefined, so an
 *     adapter that doesn't expect a per-call model sees no behavior change. panelist expresses
 *     no policy about which tier a lane should use; the string is passed through unvalidated.
 *     Takes precedence over the persona's own `modelTier` (panelist#119) when both are given —
 *     most specific wins.
 * @param {object} [deps]
 *   @param {{model,complete}} [deps.client]  injected model client (default throws).
 *   @param {function} [deps.buildPrompt]     override buildSpawnPrompt.
 *   @param {object} [deps.toolGate]          share a gate (createToolGate) across a multi-persona panel
 *     instead of spawn building its own from opts.tools.
 *   @param {number} [deps.maxTokens]         override DEFAULT_MAX_TOKENS (panelist#85).
 *   @param {number} [deps.temperature]       override DEFAULT_TEMPERATURE (panelist#85).
 * @returns {Promise<{ personaId, mode, verdict: object|null, message: string, dealKillers: string[], isolation: { tools: string[], denied: object[] }, honesty: string }>}
 */
export async function spawn(personaId, opts = {}, deps = {}) {
  const { mode, artifact, instruction, responseSchema, horizon, tools, model } = opts;
  if (!MODES.has(mode)) {
    throw new Error(`panelist spawn: mode must be one of ${[...MODES].join("|")} (got ${JSON.stringify(mode)})`);
  }
  const persona = getPersona(personaId);
  if (!persona) {
    throw new Error(`panelist spawn: unknown persona ${JSON.stringify(personaId)} — register it first.`);
  }

  const client = deps.client || throwingClient;
  const build = deps.buildPrompt || buildSpawnPrompt;
  const prompt = build({ persona, mode, artifact, instruction, responseSchema, horizon });

  // Isolation (panelist#72): deny by default. A caller may share one gate
  // across a panel (deps.toolGate); otherwise spawn builds its own from
  // opts.tools, defaulting to [] when omitted.
  const gate = deps.toolGate || createToolGate({ tools, reviewer: personaId });

  const maxTokens = deps.maxTokens ?? DEFAULT_MAX_TOKENS;
  const temperature = deps.temperature ?? DEFAULT_TEMPERATURE;
  // Model resolution (panelist#113 + panelist#119) — most specific wins:
  //   opts.model (explicit per-call) -> persona.modelTier (register-carried
  //   default) -> undefined (inherit the injected adapter's own model, i.e.
  //   today's behavior). Forward the resolved value opaquely ONLY when it is
  //   set, spreading `...(resolvedModel ? { model: resolvedModel } : {})` so
  //   the `model` key is absent entirely when neither is given (not `model:
  //   undefined`). An adapter that doesn't expect a per-call model therefore
  //   sees no behavior change and keeps using its own default;
  //   execution-shaping like maxTokens/temperature/tools, not prompt-shaping —
  //   the rendered prompt above is untouched by either `model` or
  //   `persona.modelTier`.
  const resolvedModel = model || persona.modelTier;
  const res = await client.complete({
    prompt,
    maxTokens,
    temperature,
    tools: gate.tools,
    ...(resolvedModel ? { model: resolvedModel } : {}),
  });
  if (!res || res.ok !== true || typeof res.text !== "string") {
    throw new Error(`panelist spawn: client returned no usable text for ${JSON.stringify(personaId)}`);
  }

  const parsed = extractJsonObject(res.text) || {};
  const message =
    typeof parsed.message === "string" && parsed.message.trim() ? parsed.message.trim() : res.text.trim();
  const verdict = responseSchema != null && "verdict" in parsed ? parsed.verdict : null;
  const dealKillers = normalizeDealKillers(parsed.dealKillers);

  // Merge the gate's own denials (recorded by gate.check() calls, if the
  // adapter used it) with any the adapter self-reports via res.deniedToolCalls
  // — an adapter that enforces upstream of panelist still gets denials surfaced.
  const reported = Array.isArray(res.deniedToolCalls) ? res.deniedToolCalls : [];
  const denied = [...gate.denied, ...reported.map((entry) => normalizeReportedDenial(entry, personaId)).filter(Boolean)];
  const isolation = buildIsolationEnvelope(gate.tools, denied);

  // Auto-stamp the honesty caveat on the returned envelope (panelist#81,
  // PAN-01) — spawn is the foundational single-turn contract, and runPersona
  // (runner.mjs) delegates to it unmodified, so this covers both surfaces.
  return stampHonesty({ personaId, mode, verdict, message, dealKillers, isolation });
}
