import { test } from "node:test";
import assert from "node:assert/strict";
import { runJunctionLoop, BAIL } from "../src/lib/junction.mjs";
import {
  ENGAGEMENT,
  REACTION_KEYS,
  TRACE_KEYS,
  deriveEngagement,
  normalizeEngagement,
  reactionFrom,
  buildTrace,
  aggregateJunctionTraces,
} from "../src/lib/junction-schema.mjs";

// Turn-ordered scripted client (same injected-client shape spawn.mjs/junction use):
// each element is the raw { reaction, engagement?, decision } the persona returns.
function scriptedClient(responses) {
  let i = 0;
  return {
    model: "scripted",
    async complete() {
      const r = responses[i] ?? { reaction: "(exhausted)", decision: BAIL };
      i += 1;
      return { ok: true, text: JSON.stringify(r), model: "scripted" };
    },
  };
}

// Linear hook->intro->body chain (the blog shape).
function chainGraph() {
  return {
    entry: "hook",
    junctions: {
      hook: { content: "HOOK", decisions: () => [{ id: "intro", label: "keep reading" }] },
      intro: { content: "INTRO", decisions: () => [{ id: "body", label: "get to the point" }] },
      body: { content: "BODY", decisions: () => [] },
    },
  };
}

// Hub-and-spoke with a back-edge (the jauss/book shape).
function hubGraph() {
  return {
    entry: "hub",
    junctions: {
      hub: {
        content: "HUB",
        decisions: () => [
          { id: "spokeA", label: "read A" },
          { id: "spokeB", label: "read B" },
        ],
      },
      spokeA: { content: "A", decisions: () => [{ id: "hub", label: "back" }] },
      spokeB: { content: "B", decisions: () => [{ id: "hub", label: "back" }] },
    },
  };
}

// ---- engagement derivation & normalization ----------------------------------

test("deriveEngagement: bail -> bailed, anything else -> kept", () => {
  assert.equal(deriveEngagement(BAIL), ENGAGEMENT.BAILED);
  assert.equal(deriveEngagement("intro"), ENGAGEMENT.KEPT);
  assert.equal(deriveEngagement(null), ENGAGEMENT.KEPT);
});

test("normalizeEngagement: honors a valid reported state, else derives from the decision", () => {
  assert.equal(normalizeEngagement("skimmed", "intro"), ENGAGEMENT.SKIMMED);
  assert.equal(normalizeEngagement("kept", BAIL), ENGAGEMENT.KEPT); // reported wins over derivation
  assert.equal(normalizeEngagement("nonsense", "intro"), ENGAGEMENT.KEPT); // invalid -> derived
  assert.equal(normalizeEngagement(undefined, BAIL), ENGAGEMENT.BAILED); // missing -> derived
});

test("reactionFrom projects a loop turn to EXACTLY the four generic reaction keys", () => {
  const r = reactionFrom({ turn: 3, junctionId: "intro", reaction: "meh", engagement: "skimmed", decision: "body", budgetRemaining: 5, view: {} });
  assert.deepEqual(Object.keys(r).sort(), [...REACTION_KEYS].sort());
  assert.deepEqual(r, { junction: "intro", engagement: "skimmed", decision: "body", reactionText: "meh" });
});

// ---- engagement captured end-to-end by the loop -----------------------------

test("the loop captures a persona-reported engagement and defaults a missing one", async () => {
  const client = scriptedClient([
    { reaction: "hooked", engagement: "kept", decision: "intro" },
    { reaction: "eh, skimming", engagement: "skimmed", decision: "body" }, // reported skimmed
    { reaction: "done", decision: "x" }, // no engagement, non-bail decision -> derived "kept" (body is terminal, decision ignored for nav)
  ]);
  const out = await runJunctionLoop(chainGraph(), "reader", { spawnStrategy: "persistent", client });
  assert.equal(out.path[0].engagement, "kept");
  assert.equal(out.path[1].engagement, "skimmed");
  assert.equal(out.path[2].engagement, "kept"); // missing engagement + non-bail decision -> derived kept
  assert.equal(out.stopReason, "terminal");
});

// ---- run-level trace shape ---------------------------------------------------

test("runJunctionLoop returns a trace with EXACTLY the generic trace keys", async () => {
  const client = scriptedClient([
    { reaction: "hooked", decision: "intro" },
    { reaction: "reading", decision: "body" },
    { reaction: "end", decision: BAIL },
  ]);
  const out = await runJunctionLoop(chainGraph(), "reader", { spawnStrategy: "respawn", client });
  assert.deepEqual(Object.keys(out.trace).sort(), [...TRACE_KEYS].sort());
  assert.equal(out.trace.entryJunction, "hook");
  // Every per-turn reaction carries only the generic keys.
  for (const r of out.trace.junctionTrace) {
    assert.deepEqual(Object.keys(r).sort(), [...REACTION_KEYS].sort());
  }
  assert.deepEqual(out.trace.junctionTrace.map((r) => r.junction), ["hook", "intro", "body"]);
});

test("dropOff: a completed chain reports stoppedAt 'finished'; a bail reports the junction", async () => {
  const finished = await runJunctionLoop(
    chainGraph(),
    "reader",
    { spawnStrategy: "persistent", client: scriptedClient([{ reaction: "a", decision: "intro" }, { reaction: "b", decision: "body" }, { reaction: "c", decision: BAIL }]) },
  );
  assert.equal(finished.trace.dropOff.stoppedAt, "finished");
  assert.equal(finished.stopReason, "terminal");

  const bailed = await runJunctionLoop(
    hubGraph(),
    "reader",
    { spawnStrategy: "persistent", client: scriptedClient([{ reaction: "at hub", engagement: "bailed", decision: BAIL }]) },
  );
  assert.equal(bailed.trace.dropOff.stoppedAt, "hub");
  assert.equal(bailed.trace.junctionTrace[0].engagement, "bailed");

  const exhausted = await runJunctionLoop(
    hubGraph(),
    "reader",
    { spawnStrategy: "persistent", client: scriptedClient([{ reaction: "1", decision: "spokeA" }, { reaction: "2", decision: "hub" }]), patienceBudget: 1 },
  );
  assert.equal(exhausted.stopReason, "budget-exhausted");
  assert.equal(exhausted.trace.dropOff.stoppedAt, "hub"); // last junction actually engaged before patience ran out
});

test("buildTrace on an empty run (never took a turn) falls back to the entry junction", () => {
  const trace = buildTrace({ entry: "hub", path: [], stopReason: "budget-exhausted" });
  assert.equal(trace.entryJunction, "hub");
  assert.deepEqual(trace.junctionTrace, []);
  assert.equal(trace.dropOff.stoppedAt, "hub");
});

// ---- the onComplete consumer hook + interpretation-agnostic round-trip -------

test("onComplete hook receives the trace and its return is surfaced as `verdict`", async () => {
  let seen = null;
  const out = await runJunctionLoop(
    chainGraph(),
    "reader",
    { spawnStrategy: "persistent", client: scriptedClient([{ reaction: "a", decision: "intro" }, { reaction: "b", decision: "body" }, { reaction: "c", decision: BAIL }]) },
    { onComplete: (trace) => { seen = trace; return { ok: true, turns: trace.junctionTrace.length }; } },
  );
  assert.equal(seen, out.trace); // the exact generic trace was handed to the hook
  assert.deepEqual(out.verdict, { ok: true, turns: 3 });
});

test("no hook -> verdict is null; an async hook is awaited", async () => {
  const noHook = await runJunctionLoop(chainGraph(), "reader", { spawnStrategy: "persistent", client: scriptedClient([{ reaction: "a", decision: "intro" }, { reaction: "b", decision: "body" }, { reaction: "c", decision: BAIL }]) });
  assert.equal(noHook.verdict, null);

  const asyncHook = await runJunctionLoop(
    chainGraph(),
    "reader",
    { spawnStrategy: "persistent", client: scriptedClient([{ reaction: "a", decision: BAIL }]) },
    { onComplete: async (trace) => Promise.resolve(`stopped-at:${trace.dropOff.stoppedAt}`) },
  );
  assert.equal(asyncHook.verdict, "stopped-at:hook");
});

// THE KEY ACCEPTANCE TEST: the SAME trace shape round-trips through a jauss-shaped
// "gate" verdict fn AND a blog-shaped "continue/stop" verdict fn, and the trace
// carries zero jauss-specific or blog-specific fields.
test("the same generic trace drives both a gate verdict and a continue/stop verdict", async () => {
  // A genuine mid-chain bail: engaged the hook (kept), skimmed the intro, then quit
  // before the terminal body — so reachedTerminal is meaningfully false.
  const script = [
    { reaction: "grabbed", engagement: "kept", decision: "intro" },
    { reaction: "losing me", engagement: "skimmed", decision: BAIL },
  ];

  // jauss-shaped consumer: a purpose/pull gate. Reads ONLY generic fields.
  const gateVerdict = (trace) => ({
    gate1_pass: trace.junctionTrace.some((r) => r.engagement === ENGAGEMENT.KEPT),
    reachedTerminal: trace.dropOff.stoppedAt === "finished",
  });
  // blog-shaped consumer: a continue/stop tally. Reads ONLY generic fields.
  const continueStopVerdict = (trace) => ({
    continued: trace.junctionTrace.filter((r) => r.decision !== BAIL).length,
    stopped: trace.junctionTrace.filter((r) => r.decision === BAIL).length,
  });

  const gateRun = await runJunctionLoop(chainGraph(), "reader", { spawnStrategy: "persistent", client: scriptedClient(script) }, { onComplete: gateVerdict });
  const csRun = await runJunctionLoop(chainGraph(), "reader", { spawnStrategy: "persistent", client: scriptedClient(script) }, { onComplete: continueStopVerdict });

  // Same generic trace produced regardless of which consumer is attached.
  assert.deepEqual(gateRun.trace, csRun.trace);
  // The trace has ZERO consumer-specific fields at either level.
  assert.deepEqual(Object.keys(gateRun.trace).sort(), [...TRACE_KEYS].sort());
  for (const r of gateRun.trace.junctionTrace) {
    assert.deepEqual(Object.keys(r).sort(), [...REACTION_KEYS].sort());
  }
  // Each consumer computes its own interpretation on top, outside the engine.
  assert.deepEqual(gateRun.verdict, { gate1_pass: true, reachedTerminal: false });
  assert.deepEqual(csRun.verdict, { continued: 1, stopped: 1 });
});

// ---- cross-run aggregation: preserves dispersion, never a scalar ------------

test("aggregateJunctionTraces rolls up drop-off + per-junction engagement without a scalar score", () => {
  const traces = [
    buildTrace({ entry: "hook", stopReason: "terminal", path: [
      { junctionId: "hook", engagement: "kept", decision: "intro", reaction: "" },
      { junctionId: "intro", engagement: "kept", decision: "body", reaction: "" },
      { junctionId: "body", engagement: "skimmed", decision: BAIL, reaction: "" },
    ] }),
    buildTrace({ entry: "hook", stopReason: "bail", path: [
      { junctionId: "hook", engagement: "kept", decision: "intro", reaction: "" },
      { junctionId: "intro", engagement: "bailed", decision: BAIL, reaction: "" },
    ] }),
  ];
  const agg = aggregateJunctionTraces(traces);

  assert.equal(agg.runs, 2);
  // Drop-off histogram preserves BOTH outcomes distinctly — not collapsed to a rate.
  assert.deepEqual(agg.dropOff, { finished: 1, intro: 1 });
  // Per-junction engagement counts, dispersion intact.
  assert.deepEqual(agg.perJunction.hook, { visits: 2, kept: 2, skimmed: 0, bailed: 0 });
  assert.deepEqual(agg.perJunction.intro, { visits: 2, kept: 1, skimmed: 0, bailed: 1 });
  assert.deepEqual(agg.perJunction.body, { visits: 1, kept: 0, skimmed: 1, bailed: 0 });

  // The whole aggregate is raw distributions — no scalar score/star/mean/pass-rate anywhere.
  const flat = JSON.stringify(agg);
  for (const forbidden of ["score", "stars", "mean", "average", "passRate", "rating"]) {
    assert.ok(!flat.includes(forbidden), `aggregate must not expose a ${forbidden}`);
  }
});

test("aggregateJunctionTraces tolerates an empty batch and null entries", () => {
  // The rollup is honesty-stamped (panelist#81), so compare everything except
  // that field explicitly rather than a full-object deepEqual.
  const { honesty: h1, ...empty } = aggregateJunctionTraces([]);
  const { honesty: h2, ...nulled } = aggregateJunctionTraces([null]);
  assert.deepEqual(empty, { runs: 0, dropOff: {}, perJunction: {} });
  assert.deepEqual(nulled, { runs: 0, dropOff: {}, perJunction: {} });
  assert.equal(typeof h1, "string");
  assert.equal(typeof h2, "string");
});
