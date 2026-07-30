// junction-schema.mjs — the generic reaction/decision schema + run-level trace
// aggregation for the junction loop (panelist#47, slice 2 of the multi-turn
// junction contract epic).
//
// THE MECHANICS / INTERPRETATION SPLIT (the whole point of this file)
//   The engine (junction.mjs, slice 1) emits MECHANICS: which junction the persona
//   stood on each turn, how it engaged, what it chose next, and where the walk
//   stopped. It does NOT emit interpretation — no gate verdicts, no deal-killer
//   severities, no continue/stop tallies, no scores or stars. Consumers attach
//   ALL of that on top, the same way spawn.mjs's `mode` separates the generic
//   single-turn wrapper from the mode-specific instruction text: the wrapper ships
//   no default interpretation, and neither does this.
//
//   Concretely: jauss reads the SAME generic trace this file defines and computes
//   Gate 1 (purpose-and-pull) / Gate 2 (skippable-foundations) on top of it; a
//   linear-chain blog-engagement judge reads the SAME trace and computes a
//   continue/stop tally on top of it. Neither interpretation leaks into the trace,
//   and the trace carries no field either of them owns. If you find yourself adding
//   a jauss-specific or blog-specific field HERE, it belongs in the consumer's
//   verdict hook (junction.mjs's runJunctionLoop `onComplete`) instead.
//
// SHAPES
//   Per-turn reaction (engine-owned, consumer-agnostic):
//     { junction: <id>, engagement: "kept"|"skimmed"|"bailed", decision: <id>|"bail", reactionText: <free text> }
//   `engagement` is the generic 3-state jauss already uses. A linear-chain consumer
//   like the blog judge can use only kept/bailed and ignore "skimmed" — same shape,
//   no schema change needed.
//
//   Run-level trace (engine-owned):
//     { entryJunction, junctionTrace: [<per-turn reaction>...], dropOff: { stoppedAt: <junction>|"finished", reason: <text> } }
//
// Pure, zero-dep. This file holds only the schema, the trace builder, and the
// cross-run aggregation helper; the loop that produces the raw turns lives in
// junction.mjs and imports from here.

import { BAIL } from "./junction.mjs";
import { stampHonesty } from "./honesty.mjs";

/** The generic 3-state engagement, engine-owned. Consumers may ignore "skimmed". */
export const ENGAGEMENT = Object.freeze({ KEPT: "kept", SKIMMED: "skimmed", BAILED: "bailed" });
const ENGAGEMENT_VALUES = new Set(Object.values(ENGAGEMENT));

/** The exact key set of a per-turn reaction — asserted by the interpretation-agnostic test. */
export const REACTION_KEYS = Object.freeze(["junction", "engagement", "decision", "reactionText"]);
/** The exact key set of a run-level trace. */
export const TRACE_KEYS = Object.freeze(["entryJunction", "junctionTrace", "dropOff"]);

/**
 * Derive a generic engagement state when the persona did not report one. The engine
 * can always tell "bailed" apart mechanically (the decision was BAIL); it cannot
 * tell "skimmed" from "kept" without a persona signal, so both non-bail turns
 * default to "kept". A consumer that wants the finer skimmed/kept distinction must
 * have the persona report `engagement` in its reply.
 * @param {string|null} decision
 * @returns {"kept"|"bailed"}
 */
export function deriveEngagement(decision) {
  return decision === BAIL ? ENGAGEMENT.BAILED : ENGAGEMENT.KEPT;
}

/** Normalize a persona-reported engagement to a valid 3-state, else derive it. */
export function normalizeEngagement(engagement, decision) {
  return typeof engagement === "string" && ENGAGEMENT_VALUES.has(engagement)
    ? engagement
    : deriveEngagement(decision);
}

/**
 * Map one loop turn record (junction.mjs's `path`/`transcript` entry) to the generic
 * per-turn reaction shape. Deliberately projects to EXACTLY the four REACTION_KEYS —
 * anything the engine happens to carry internally (turn index, budget remaining, the
 * rendered view) is dropped so no mechanics-adjacent field can be mistaken for
 * interpretation.
 * @param {{junctionId:string, engagement?:string, decision:string|null, reaction?:string}} turn
 */
export function reactionFrom(turn) {
  return {
    junction: turn.junctionId,
    engagement: normalizeEngagement(turn.engagement, turn.decision),
    decision: turn.decision,
    reactionText: typeof turn.reaction === "string" ? turn.reaction : "",
  };
}

/** Human-readable drop-off reasons, keyed by the loop's stopReason. */
const DROP_OFF_REASON = {
  bail: "persona bailed voluntarily",
  "budget-exhausted": "patience budget exhausted before finishing",
  "invalid-decision": "persona chose an unavailable/hallucinated decision",
  terminal: "reached a terminal junction with no further decisions",
};

/**
 * Build the run-level trace from a finished loop result. Interpretation-free: it
 * reports where the persona stopped and why, never whether that outcome was "good".
 *
 * `dropOff.stoppedAt` is "finished" when the walk ended by reaching a terminal
 * junction (the natural end of a linear chain); otherwise it is the id of the
 * junction the persona was standing on when the run ended (bail, patience
 * exhaustion, or an invalid decision).
 *
 * @param {{entry:string, path:Array, stopReason:string}} loopResult
 * @returns {{entryJunction:string, junctionTrace:Array, dropOff:{stoppedAt:string, reason:string}}}
 */
export function buildTrace(loopResult) {
  const { entry, path = [], stopReason } = loopResult || {};
  const junctionTrace = path.map(reactionFrom);
  const lastJunction = path.length ? path[path.length - 1].junctionId : entry;
  const stoppedAt = stopReason === "terminal" ? "finished" : lastJunction;
  const reason = DROP_OFF_REASON[stopReason] || `run ended (${stopReason ?? "unknown"})`;
  return { entryJunction: entry, junctionTrace, dropOff: { stoppedAt, reason } };
}

/**
 * Roll up a stratified batch of traces WITHOUT collapsing dispersion into a single
 * scalar. Mirrors jauss's "Aggregation across the 10 draws" rollup and honors its
 * "never average into a single happy number" rule: this returns raw distributions
 * (a drop-off histogram and per-junction engagement counts), never a score, star,
 * mean, or pass-rate. A consumer that wants a headline number must compute it itself
 * and own the reductive choice.
 *
 * @param {Array<{entryJunction:string, junctionTrace:Array, dropOff:object}>} traces
 * @returns {{
 *   runs:number,
 *   dropOff: Record<string, number>,                                   // histogram over stoppedAt (incl. "finished")
 *   perJunction: Record<string, {visits:number, kept:number, skimmed:number, bailed:number}>,
 * }}
 */
export function aggregateJunctionTraces(traces = []) {
  const dropOff = {};
  const perJunction = {};
  for (const trace of traces) {
    if (!trace) continue;
    const stoppedAt = trace.dropOff?.stoppedAt ?? "unknown";
    dropOff[stoppedAt] = (dropOff[stoppedAt] || 0) + 1;
    for (const r of trace.junctionTrace || []) {
      const bucket = (perJunction[r.junction] ||= { visits: 0, kept: 0, skimmed: 0, bailed: 0 });
      bucket.visits += 1;
      if (r.engagement in bucket && r.engagement !== "visits") bucket[r.engagement] += 1;
    }
  }
  // Stamp the returned rollup — it's a public output surface in its own right
  // (panelist#81), distinct from the per-run traces it aggregates (which stay
  // unstamped; only the top-level runJunctionLoop envelope is stamped, not the
  // trace — see junction.mjs).
  return stampHonesty({ runs: traces.filter(Boolean).length, dropOff, perJunction });
}
