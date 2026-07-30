// honesty-gate.test.mjs — panelist#86: checkHonesty had zero call sites.
//
// checkHonesty (drift-check.mjs) is the BATCH honesty-stamp guardrail: given
// an array of panel summaries/envelopes, it reports which ones (by index)
// omit the honesty caveat. Before this test it was exported but never
// invoked by anything that runs in CI — main()/scanRepo scan repo RECORDS,
// not panel summaries, so wiring it there would be wrong (the issue's own
// analysis). This test is the correct vehicle: it builds a real batch of
// plane outputs offline (same mock-client + invocation patterns as
// honesty-surfaces.test.mjs), proves checkHonesty passes the all-stamped
// batch, and then proves it actually FAILS when a deliberately-unstamped
// summary is mixed in — a gate that can't fail isn't a gate.

import { test } from "node:test";
import assert from "node:assert/strict";

import { checkHonesty } from "../src/lib/drift-check.mjs";
import { score, rankCandidatesWith } from "../src/lib/score.mjs";
import { spawn } from "../src/lib/spawn.mjs";
import { runJunctionLoop, BAIL } from "../src/lib/junction.mjs";
import { aggregateJunctionTraces, buildTrace } from "../src/lib/junction-schema.mjs";
import { calibratePersonas } from "../src/lib/calibrate.mjs";
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

/** Build one real, offline batch entry per execution plane. */
async function buildStampedBatch() {
  const scorePanel = [fixedScorer("claude-3-5-sonnet", GOOD), fixedScorer("gpt-4o", GOOD)];
  const scoreResult = await score(cand, reviewPack.slice(0, 2), RUBRIC, { panel: scorePanel });

  const fallbackPanel = [deadClient("claude-x"), deadClient("gpt-y")];
  const fallbackResult = await score(cand, reviewPack.slice(0, 1), RUBRIC, { panel: fallbackPanel });

  const rankResult = await rankCandidatesWith([cand], reviewPack.slice(0, 2), RUBRIC, { panel: scorePanel });

  clearRegistry();
  registerPersonas(reviewPack);
  const spawnClient = fixedSpawn("claude-x", { message: "reacting", dealKillers: [] });
  const spawnResult = await spawn("drive-by-installer", { mode: "comment", artifact: "# doc" }, { client: spawnClient });
  clearRegistry();

  const junctionClient = scriptedClient([
    { reaction: "a", decision: "intro" },
    { reaction: "b", decision: "body" },
  ]);
  const junctionResult = await runJunctionLoop(chainGraph(), READER, { spawnStrategy: "persistent", client: junctionClient });

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
  const aggregateResult = aggregateJunctionTraces(traces);

  const calibrateResult = calibratePersonas({
    items: ["a", "b", "c", "d"],
    syntheticByPersona: { predictive: [1, 2, 3, 4] },
    realSignal: [1, 2, 3, 4],
  });

  return [
    scoreResult,
    fallbackResult,
    rankResult,
    spawnResult,
    junctionResult,
    aggregateResult,
    calibrateResult,
  ];
}

test("checkHonesty passes a real, all-stamped batch built from every execution plane", async () => {
  const batch = await buildStampedBatch();
  const report = checkHonesty(batch);
  assert.equal(report.ok, true);
  assert.deepEqual(report.offenders, []);
});

test("checkHonesty FAILS and pinpoints a deliberately-unstamped summary mixed into the batch", async () => {
  const batch = await buildStampedBatch();

  // Deliberately unstamped: an envelope with a verdict but no honesty field
  // at all — the shape a caller would produce if it bypassed stampHonesty.
  const unstampedEnvelope = { verdict: "keep", dealKillers: [] };
  // Deliberately unstamped: a plain string summary with no honesty marker.
  const unstampedString = "KEEP. No deal-killers surfaced.";

  const withOneOffender = [...batch, unstampedEnvelope];
  const oneOffenderReport = checkHonesty(withOneOffender);
  assert.equal(oneOffenderReport.ok, false);
  assert.deepEqual(oneOffenderReport.offenders, [withOneOffender.length - 1]);

  const withTwoOffenders = [batch[0], unstampedString, batch[1], unstampedEnvelope];
  const twoOffenderReport = checkHonesty(withTwoOffenders);
  assert.equal(twoOffenderReport.ok, false);
  assert.deepEqual(twoOffenderReport.offenders, [1, 3]);
});
