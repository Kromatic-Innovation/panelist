// honesty-surfaces.test.mjs — table-driven coverage for panelist#81: every
// public output surface must carry the honesty caveat by construction.
//
// This is deliberately a TABLE, not one ad-hoc test per surface: a future
// surface added to the table without a stamp fails here immediately, instead
// of quietly shipping an unstamped output the way the audited 8 did. Each
// row builds its surface entirely offline (mock clients from test/_helpers.mjs,
// scripted junction clients, synthetic calibration data) and asserts
// `assertHonestyStamped(result).ok === true`.
//
// Also assumed by the offline mocks below: the score.mjs / spawn.mjs /
// junction.mjs contracts described in their own module headers.

import { test } from "node:test";
import assert from "node:assert/strict";

import { score, rankCandidatesWith } from "../src/lib/score.mjs";
import { spawn } from "../src/lib/spawn.mjs";
import { runPersona } from "../src/lib/runner.mjs";
import { runJunctionLoop, BAIL } from "../src/lib/junction.mjs";
import { aggregateJunctionTraces, buildTrace, REACTION_KEYS, TRACE_KEYS } from "../src/lib/junction-schema.mjs";
import { calibratePersonas } from "../src/lib/calibrate.mjs";
import { assertHonestyStamped } from "../src/lib/honesty.mjs";
import { registerPersonas, clearRegistry } from "../src/lib/register.mjs";
import { fixedScorer, deadClient, fixedSpawn } from "./_helpers.mjs";
import reviewPack from "../packs/review/index.mjs";

const RUBRIC = {
  axes: ["resonance", "clarity", "credibility", "scrollStop"],
  killAxes: ["clarity", "credibility"],
  killFloor: 4.0,
  cut_threshold: 5.0,
};
const GOOD = { resonance: 8, clarity: 8, credibility: 8, scrollStop: 8 };
const cand = { text: "A clear, grounded artifact under review." };

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

const READER = { id: "reader", name: "Skimming Reader", role: "impatient web reader", caresAbout: ["speed"] };

// ── The table ────────────────────────────────────────────────────────────────
// Each row: { name, run() } where run() returns the surface's output (awaited).

const SURFACES = [
  {
    name: "score()/scoreCandidate() — default path (already stamped, panelist#6)",
    run: async () => {
      const panel = [fixedScorer("claude-3-5-sonnet", GOOD), fixedScorer("gpt-4o", GOOD)];
      return score(cand, reviewPack.slice(0, 2), RUBRIC, { panel });
    },
  },
  {
    name: "score() — built-in neutralFallback on whole-panel failure (already stamped, panelist#6)",
    run: async () => {
      const panel = [deadClient("claude-x"), deadClient("gpt-y")];
      return score(cand, reviewPack.slice(0, 1), RUBRIC, { panel });
    },
  },
  {
    name: "score() with a custom deps.fallback (PAN-03) — post-processed through stampHonesty",
    run: async () => {
      const panel = [deadClient("claude-x"), deadClient("gpt-y")];
      const customFallback = (candidate, panelistsFailed) => ({
        candidate,
        scores: { byPersona: [], byModel: {} },
        aggregate: { overall: 0 },
        verdict: "cut",
        crossModel: false,
        panelistsFailed,
        fallback: true,
        custom: true,
        // Deliberately NO honesty field — the caller's callback replaces
        // neutralFallback wholesale; the call site must stamp it.
      });
      return score(cand, reviewPack.slice(0, 1), RUBRIC, { panel, fallback: customFallback });
    },
  },
  {
    name: "rankCandidatesWith() — the returned { shortlist, cut } wrapper",
    run: async () => {
      const panel = [fixedScorer("claude-3-5-sonnet", GOOD), fixedScorer("gpt-4o", GOOD)];
      return rankCandidatesWith([cand], reviewPack.slice(0, 2), RUBRIC, { panel });
    },
  },
  {
    name: "spawn() — the invocation-contract wrapper",
    run: async () => {
      clearRegistry();
      registerPersonas(reviewPack);
      const client = fixedSpawn("claude-x", { message: "reacting", dealKillers: [] });
      const out = await spawn("drive-by-installer", { mode: "comment", artifact: "# doc" }, { client });
      clearRegistry();
      return out;
    },
  },
  {
    name: "runPersona() — delegates to spawn unmodified",
    run: async () => {
      clearRegistry();
      registerPersonas(reviewPack);
      const client = fixedSpawn("claude-x", { message: "reacting", dealKillers: [] });
      const out = await runPersona("drive-by-installer", { mode: "comment", artifact: "# doc" }, { client });
      clearRegistry();
      return out;
    },
  },
  {
    name: "runJunctionLoop() — the returned top-level envelope",
    run: async () => {
      const client = scriptedClient([
        { reaction: "a", decision: "intro" },
        { reaction: "b", decision: "body" },
      ]);
      return runJunctionLoop(chainGraph(), READER, { spawnStrategy: "persistent", client });
    },
  },
  {
    name: "aggregateJunctionTraces() — the returned rollup",
    run: async () => {
      const traces = [
        buildTrace({
          entry: "hook",
          stopReason: "terminal",
          path: [
            { junctionId: "hook", engagement: "kept", decision: "intro", reaction: "" },
            { junctionId: "intro", engagement: "kept", decision: "body", reaction: "" },
          ],
        }),
      ];
      return aggregateJunctionTraces(traces);
    },
  },
  {
    name: "calibratePersonas() — additive honesty field alongside the existing note",
    run: async () => {
      const items = ["a", "b", "c", "d"];
      const realSignal = [1, 2, 3, 4];
      const syntheticByPersona = { predictive: [1, 2, 3, 4] };
      return calibratePersonas({ items, syntheticByPersona, realSignal });
    },
  },
];

for (const { name, run } of SURFACES) {
  test(`honesty stamp: ${name}`, async () => {
    const result = await run();
    const check = assertHonestyStamped(result);
    assert.equal(check.ok, true, check.reason);
  });
}

// ── The junction TRACE must stay UNstamped, and its locked key sets must hold ──

test("runJunctionLoop's nested trace stays UNstamped, and TRACE_KEYS/REACTION_KEYS still hold", async () => {
  const client = scriptedClient([
    { reaction: "a", decision: "intro" },
    { reaction: "b", decision: "body" },
  ]);
  const out = await runJunctionLoop(chainGraph(), READER, { spawnStrategy: "persistent", client });

  // The envelope IS stamped...
  assert.equal(assertHonestyStamped(out).ok, true);
  // ...but the nested trace is NOT, and carries exactly the locked key set.
  assert.equal("honesty" in out.trace, false, "the trace must never carry an honesty field");
  assert.deepEqual(Object.keys(out.trace).sort(), [...TRACE_KEYS].sort());
  for (const reaction of out.trace.junctionTrace) {
    assert.equal("honesty" in reaction, false, "a per-turn reaction must never carry an honesty field");
    assert.deepEqual(Object.keys(reaction).sort(), [...REACTION_KEYS].sort());
  }
});
