// junction.mjs — the generic junction-graph + loop-runner primitive (panelist#46, slice 1 of the multi-turn junction contract epic).
//
// This is the engine underneath the multi-turn information-barrier loop currently
// hand-rolled in cwc's `jauss` skill. jauss walks a branching hub-and-spoke graph;
// a future blog-engagement judge walks a linear hook->intro->body chain. Both need
// the SAME core move — "reveal one junction at a time, let the persona decide what's
// next, never let it see content it didn't choose" — so this builds ONE engine, not
// two. jauss and the blog judge are just two graphs handed to the same runner.
//
//   runJunctionLoop(graph, persona, { horizon, spawnStrategy, client, patienceBudget, tools, toolGate })
//     -> { strategy, entry, path, stopReason, turns, budgetRemaining, transcript, isolation }
//
// GRAPH SHAPE
//   {
//     junctions: {
//       [id]: {
//         content,            // string, OR (state) => string — resolved LAZILY (see barrier below)
//         decisions(state),   // (state) => [{ id, label }] — forward moves from here; id is the TARGET junction id
//         cost?,              // number, default 1 — patience this junction consumes when engaged (the graph's "rate")
//       },
//     },
//     entry,                  // id of the starting junction
//     patience?(horizon),     // optional (horizon) => number — seeds the patience budget from the horizon (jauss's drawn time-budget)
//   }
//
// THE STRUCTURAL BARRIER (the whole point — not a convention the caller must remember)
//   The runner is PHYSICALLY unable to hand the persona a junction's content before
//   that junction is chosen. It only ever touches `graph.junctions[current]` — the
//   junction it is standing on right now — and resolves that junction's `content`
//   lazily, keyed off the decision just made. It NEVER iterates all junctions, never
//   pre-assembles the graph into one big prompt, and never reads an unchosen
//   junction's content. So an unchosen junction's content simply cannot leak into any
//   prompt: there is no code path that reads it. (Directly asserted by the sentinel
//   test in test/junction.test.mjs.)
//
// SPAWN STRATEGIES (both required; jauss treats them as an equally-valid cost-vs-
// simplicity tradeoff left to the caller)
//   "persistent" — one accumulating conversation across turns. Each turn appends the
//                  current junction's view and the persona's reply to a running
//                  transcript, and the whole transcript is re-sent. Context
//                  accumulates naturally (higher token cost, zero bookkeeping).
//   "respawn"    — a fresh call per turn, built from { horizon, transcriptSoFar,
//                  currentJunctionOnly } (cheaper per call; the caller re-hydrates a
//                  compact transcript rather than resending the full conversation).
//   BOTH build the current-junction view through the SAME renderJunctionView helper,
//   so the barrier logic lives in exactly one place and is never duplicated.
//
// THE MODEL CALL is the SAME injected-client contract spawn.mjs uses — deps/opts
// `client: { model, complete: async ({prompt,maxTokens,temperature,tools}) => {ok,text,model} }`.
// We do NOT hand-roll a second model-call path: like spawn, every turn is one
// `client.complete({ prompt, tools })`, and the reply is parsed with score.mjs's
// extractJsonObject. Isolation (panelist#72/#75) is gated the SAME way spawn.mjs
// gates it: deny-by-default via `opts.tools`/`opts.toolGate` (isolation.mjs's
// createToolGate), and the returned `isolation: { tools, denied }` envelope is
// present on every stop path (bail, budget-exhaustion, terminal, invalid-decision) —
// there is exactly one return statement in this loop, so no early-return path can
// skip the envelope. (spawn() itself is single-turn and registry-bound, so it can
// neither hold the "persistent" accumulating conversation nor render the junction
// view; this runner is the multi-turn generalization of the same contract, not a
// competing one. The generic reaction/decision schema + run-level trace aggregation
// land in the co-located junction-schema.mjs (panelist#47, slice 2): the loop now
// captures a 3-state `engagement` per turn, returns a `trace` in the generic shape,
// and invokes an optional consumer `onComplete(trace)` hook — mechanics only; all
// interpretation (jauss's gates, a blog judge's continue/stop tally) stays in the
// consumer's hook.)
//
// Pure, zero-dep beyond existing helpers (renderPersona, extractJsonObject) and the
// co-located schema builder (buildTrace, normalizeEngagement).

import { renderPersona, extractJsonObject, fenceArtifact } from "./score.mjs";
import { buildTrace, normalizeEngagement } from "./junction-schema.mjs";
import { createToolGate, buildIsolationEnvelope, recordDenial } from "./isolation.mjs";
import { stampHonesty } from "./honesty.mjs";
import { BAIL } from "./junction-constants.mjs";

// BAIL is defined in the leaf junction-constants.mjs (panelist#89) so both this
// module and junction-schema.mjs can depend on it without a cycle; re-exported here
// so `import { BAIL } from "panelist"` (src/index.mjs) keeps working unchanged.
export { BAIL };
const BAIL_DECISION = { id: BAIL, label: "Bail — stop here; you've seen enough." };

// Default patience when neither the call nor the graph seeds one. Finite so a run
// can always terminate even if the persona never bails and the graph has a cycle.
const DEFAULT_PATIENCE = 12;

// DEFAULT_MAX_TOKENS/DEFAULT_TEMPERATURE (panelist#85, PAN-09): named, and now
// overridable via opts.maxTokens/opts.temperature (see runJunctionLoop below).
// Matches spawn.mjs's 1024 default (a free-text persona turn, not score.mjs's
// tighter fixed-shape JSON score object) — see spawn.mjs's comment for why that
// divergence from score.mjs is deliberate and out of scope to unify here.
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TEMPERATURE = 0;

/** Resolve a junction's content lazily, keyed off the current run state. */
function resolveContent(junction, state) {
  const c = junction.content;
  return typeof c === "function" ? c(state) : c == null ? "" : String(c);
}

/** Render the persona block from a record (via renderPersona) or a raw string. */
function renderPersonaBlock(persona) {
  if (persona == null) return "";
  return typeof persona === "string" ? persona : renderPersona(persona);
}

/** Attribution string for isolation.mjs denial records — a persona id, or "junction" for a raw string persona. */
function reviewerFor(persona) {
  if (persona && typeof persona === "object" && typeof persona.id === "string" && persona.id) return persona.id;
  return "junction";
}

/** Normalize a client-reported denial entry (string tool id, or {tool, at}) into the locked shape. */
function normalizeReportedDenial(entry, reviewer) {
  if (typeof entry === "string") return recordDenial(entry, reviewer);
  if (entry && typeof entry === "object" && typeof entry.tool === "string") {
    return recordDenial(entry.tool, reviewer, entry.at);
  }
  return null;
}

/** The forward decisions from a junction PLUS the always-available bail option. */
function decisionsFor(junction, state) {
  const forward = typeof junction.decisions === "function" ? junction.decisions(state) || [] : [];
  return [...forward, BAIL_DECISION];
}

/**
 * Render the view of ONE junction — its content plus the menu of decisions
 * available from it. This is the ONLY place a junction's content enters a prompt,
 * and it is only ever called for the CURRENT junction, so the barrier is structural.
 *
 * Exported (minimal surface, panelist#82) so tests can assert the fence
 * built here is unbreakable without threading a full graph through
 * runJunctionLoop + a capturing mock client.
 *
 * @returns {{ content: string, decisions: {id,label}[], text: string }}
 */
export function renderJunctionView(junction, state) {
  const content = resolveContent(junction, state);
  const decisions = decisionsFor(junction, state);
  const menu = decisions.map((d) => `  - ${d.id}: ${d.label}`).join("\n");
  const text = [
    "CURRENT JUNCTION:",
    fenceArtifact(content),
    "",
    "YOUR AVAILABLE DECISIONS (choose exactly one by its id):",
    menu,
  ].join("\n");
  return { content, decisions, text };
}

const CONTRACT = [
  "Reply with ONLY a JSON object (no prose, no markdown fences):",
  '{\n  "reaction": "<your in-voice reaction to THIS junction>",\n  "engagement": "kept" | "skimmed" | "bailed",\n  "decision": "<the id of the one decision you choose>"\n}',
  'engagement: "kept" = you read this junction properly; "skimmed" = you skated over it; "bailed" = you are done here. It is optional — leave it out and it is inferred from your decision.',
].join("\n");

/**
 * Build the prompt for the "persistent" strategy: the full accumulating
 * conversation so far, then this turn's junction view. Prior turns are the
 * junctions the persona ALREADY chose (so re-sending them never breaks the
 * barrier), plus the persona's own replies.
 */
function renderPersistentPrompt({ personaBlock, horizon, history, view }) {
  const convo = history.flatMap((h) => [
    `--- turn ${h.turn} @ junction "${h.junctionId}" ---`,
    h.view.text,
    `PERSONA REPLIED: ${JSON.stringify({ reaction: h.reaction, decision: h.decision })}`,
  ]);
  return [
    "You are a persona walking a decision graph ONE junction at a time. You see only the junction you are standing on and the decisions available from it — never anything you did not choose.",
    "",
    personaBlock,
    horizon ? `\nTIME HORIZON: ${horizon}` : "",
    convo.length ? `\nCONVERSATION SO FAR:\n${convo.join("\n")}` : "",
    "",
    view.text,
    "",
    CONTRACT,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Build the prompt for the "respawn" strategy: a fresh call per turn assembled from
 * { horizon, transcriptSoFar, currentJunctionOnly }. transcriptSoFar is a compact
 * record of the junctions already visited (all chosen — barrier-safe) and the
 * decisions taken; currentJunctionOnly is this turn's view.
 */
function renderRespawnPrompt({ personaBlock, horizon, history, view }) {
  const transcriptSoFar = history.map(
    (h) => `  turn ${h.turn}: at "${h.junctionId}" you reacted ${JSON.stringify(h.reaction)} and chose "${h.decision}".`,
  );
  return [
    "You are a persona walking a decision graph ONE junction at a time. Each turn you are re-briefed with a short transcript of what you have done so far, then shown ONLY the junction you are standing on now.",
    "",
    personaBlock,
    horizon ? `\nTIME HORIZON: ${horizon}` : "",
    transcriptSoFar.length ? `\nTRANSCRIPT SO FAR:\n${transcriptSoFar.join("\n")}` : "\nTRANSCRIPT SO FAR: (this is your first junction)",
    "",
    view.text,
    "",
    CONTRACT,
  ]
    .filter(Boolean)
    .join("\n");
}

const RENDERERS = { persistent: renderPersistentPrompt, respawn: renderRespawnPrompt };

/** Parse the persona's { reaction, engagement?, decision } reply; tolerant of loose formatting. */
function parseReply(text) {
  const obj = extractJsonObject(text) || {};
  const reaction = typeof obj.reaction === "string" ? obj.reaction : typeof text === "string" ? text.trim() : "";
  const decision = typeof obj.decision === "string" ? obj.decision.trim() : null;
  const engagement = typeof obj.engagement === "string" ? obj.engagement.trim() : null;
  return { reaction, engagement, decision };
}

/**
 * Run the junction loop: start at the entry junction, reveal one junction at a
 * time, let the persona react and choose the next junction, and stop on bail,
 * patience exhaustion, an invalid decision, or reaching a terminal junction.
 *
 * @param {object} graph    { junctions, entry, patience? } — see the GRAPH SHAPE header.
 * @param {object|string} persona   a persona record (rendered via renderPersona) or a pre-rendered string.
 * @param {object} opts
 *   @param {string}  [opts.horizon]        passed to the persona and used to seed patience.
 *   @param {"persistent"|"respawn"} [opts.spawnStrategy="persistent"]
 *   @param {{model,complete}} opts.client  injected model client (same shape as spawn's deps.client).
 *   @param {number|function} [opts.patienceBudget]  initial patience (number, or (state)=>number). Falls back to
 *                                                    graph.patience(horizon), then DEFAULT_PATIENCE.
 *   @param {string[]} [opts.tools]  explicit tool allowlist (panelist#72/#75). Omit for none — runJunctionLoop
 *     is fully isolated by default, same posture as spawn. No wildcards; see isolation.mjs.
 *   @param {object} [opts.toolGate]  share a gate (isolation.mjs's createToolGate) across several calls
 *     instead of runJunctionLoop building its own from opts.tools.
 *   @param {number} [opts.maxTokens]     override DEFAULT_MAX_TOKENS (panelist#85).
 *   @param {number} [opts.temperature]   override DEFAULT_TEMPERATURE (panelist#85).
 * @param {object} [hooks]
 *   @param {(trace:object)=>any} [hooks.onComplete]  consumer verdict hook: invoked ONCE with the finished
 *                                                    generic trace (see junction-schema.mjs) so a consumer can
 *                                                    compute its OWN interpretation (jauss's gates, a blog judge's
 *                                                    continue/stop tally) entirely outside the engine. The engine
 *                                                    ships no default hook — its return value is surfaced as
 *                                                    `verdict` and is otherwise ignored by the engine.
 * @returns {Promise<{
 *   strategy: string, entry: string,
 *   path: {turn:number, junctionId:string, reaction:string, engagement:string, decision:string|null, budgetRemaining:number}[],
 *   stopReason: "bail"|"budget-exhausted"|"terminal"|"invalid-decision",
 *   turns: number, budgetRemaining: number,
 *   transcript: {turn:number, junctionId:string, view:object, reaction:string, engagement:string, decision:string|null}[],
 *   trace: {entryJunction:string, junctionTrace:object[], dropOff:{stoppedAt:string, reason:string}},
 *   verdict: any,
 *   isolation: { tools: string[], denied: object[] },
 * }>}
 */
export async function runJunctionLoop(graph, persona, opts = {}, hooks = {}) {
  if (!graph || typeof graph.junctions !== "object" || graph.junctions == null) {
    throw new Error("panelist junction: graph must be { junctions: {...}, entry }.");
  }
  const { horizon, spawnStrategy = "persistent", client, patienceBudget, tools, toolGate, maxTokens, temperature } = opts;
  const render = RENDERERS[spawnStrategy];
  if (!render) {
    throw new Error(`panelist junction: spawnStrategy must be one of ${Object.keys(RENDERERS).join("|")} (got ${JSON.stringify(spawnStrategy)})`);
  }
  if (!client || typeof client.complete !== "function") {
    throw new Error("panelist junction: inject a client (opts.client: { model, complete }) — no live provider is bundled.");
  }
  if (!(graph.entry in graph.junctions)) {
    throw new Error(`panelist junction: entry ${JSON.stringify(graph.entry)} is not a junction in the graph.`);
  }

  const personaBlock = renderPersonaBlock(persona);

  // Isolation (panelist#72/#75): deny by default, same posture as spawn.mjs. A
  // caller may share one gate (opts.toolGate); otherwise runJunctionLoop builds
  // its own from opts.tools, defaulting to [] when omitted.
  const gate = toolGate || createToolGate({ tools, reviewer: reviewerFor(persona) });
  const reportedDenied = [];

  // Seed the patience budget. Explicit opt wins; then a graph-supplied patience(horizon); then the default.
  const seed =
    typeof patienceBudget === "function"
      ? patienceBudget({ horizon })
      : typeof patienceBudget === "number"
        ? patienceBudget
        : typeof graph.patience === "function"
          ? graph.patience(horizon)
          : DEFAULT_PATIENCE;
  let budget = Number.isFinite(seed) ? seed : DEFAULT_PATIENCE;

  const transcript = [];
  const path = [];
  let current = graph.entry;
  let turn = 0;
  let stopReason;

  // Loop invariant: `current` is always a valid junction id we have NOT yet exceeded budget for.
  while (true) {
    const junction = graph.junctions[current];
    const cost = typeof junction.cost === "number" ? junction.cost : 1;

    // Patience gate: if we cannot afford to engage this junction, the persona's
    // patience is spent — the run ends WITHOUT an explicit bail (distinguishable
    // from a bail by stopReason).
    if (budget < cost) {
      stopReason = "budget-exhausted";
      break;
    }

    const state = { horizon, junctionId: current, turn, budgetRemaining: budget, history: transcript };
    const view = renderJunctionView(junction, state);

    // Spend patience and take the turn.
    budget -= cost;
    turn += 1;
    const prompt = render({ personaBlock, horizon, history: transcript, view });
    const res = await client.complete({
      prompt,
      maxTokens: maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: temperature ?? DEFAULT_TEMPERATURE,
      tools: gate.tools,
    });
    if (!res || res.ok !== true || typeof res.text !== "string") {
      throw new Error(`panelist junction: client returned no usable text at junction ${JSON.stringify(current)}.`);
    }
    // Merge the gate's own denials (recorded by gate.check() calls, if the adapter
    // used it) with any the adapter self-reports via res.deniedToolCalls — an
    // adapter that enforces upstream of panelist still gets denials surfaced.
    const reported = Array.isArray(res.deniedToolCalls) ? res.deniedToolCalls : [];
    for (const entry of reported) {
      const denial = normalizeReportedDenial(entry, reviewerFor(persona));
      if (denial) reportedDenied.push(denial);
    }
    const { reaction, engagement: rawEngagement, decision } = parseReply(res.text);
    // Normalize the persona-reported engagement to the generic 3-state now (idempotent
    // when re-projected by the schema builder), deriving it from the decision when the
    // persona left it out — so `path`/`transcript` always carry a valid engagement.
    const engagement = normalizeEngagement(rawEngagement, decision);

    transcript.push({ turn, junctionId: current, view, reaction, engagement, decision });
    path.push({ turn, junctionId: current, reaction, engagement, decision, budgetRemaining: budget });

    const forwardIds = new Set(view.decisions.filter((d) => d.id !== BAIL).map((d) => d.id));

    // Terminal junction: no onward decisions, so the walk is complete (the end of a
    // linear hook->intro->body chain). This is the natural end and is reported
    // distinctly from an early, voluntary bail — regardless of the reply, there is
    // nowhere left to go.
    if (forwardIds.size === 0) {
      stopReason = "terminal";
      break;
    }

    // Explicit bail — a clean, voluntary stop from a junction that DID offer a way forward.
    if (decision === BAIL) {
      stopReason = "bail";
      break;
    }

    // The chosen decision must name an available forward junction; anything else
    // (a hallucinated id, a null) ends the run cleanly rather than looping.
    if (decision == null || !forwardIds.has(decision) || !(decision in graph.junctions)) {
      stopReason = "invalid-decision";
      break;
    }

    current = decision;
  }

  // Isolation envelope (panelist#72/#75): present on EVERY stop path (bail,
  // budget-exhaustion, terminal, invalid-decision) because there is exactly one
  // return statement in this loop — no early-return path can skip it.
  const isolation = buildIsolationEnvelope(gate.tools, [...gate.denied, ...reportedDenied]);

  const result = { strategy: spawnStrategy, entry: graph.entry, path, stopReason, turns: turn, budgetRemaining: budget, transcript, isolation };

  // The generic run-level trace (mechanics only). A consumer's onComplete hook may
  // read it to compute its own interpretation; the engine bundles no default hook.
  const trace = buildTrace(result);
  const verdict = typeof hooks.onComplete === "function" ? await hooks.onComplete(trace) : null;

  // Stamp the ENVELOPE (this top-level result), NOT the trace — the trace's
  // per-turn reactions and key set are locked (REACTION_KEYS/TRACE_KEYS,
  // junction-schema.mjs) and must never carry an honesty field (panelist#81).
  return stampHonesty({ ...result, trace, verdict });
}
