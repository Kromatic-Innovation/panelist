import { test } from "node:test";
import assert from "node:assert/strict";
import { score, scoreCandidate, decideVerdict } from "../src/lib/score.mjs";
import { HONESTY_MARKER } from "../src/lib/honesty.mjs";
import { fixedScorer, deadClient } from "./_helpers.mjs";
import reviewPack from "../packs/review/index.mjs";

const RUBRIC = {
  axes: ["resonance", "clarity", "credibility", "scrollStop"],
  killAxes: ["clarity", "credibility"],
  killFloor: 4.0,
  cut_threshold: 5.0,
};
const GOOD = { resonance: 8, clarity: 8, credibility: 8, scrollStop: 8 };
const cand = { text: "A clear, grounded artifact under review." };

test("scoreCandidate throws when no panel is injected", async () => {
  await assert.rejects(() => scoreCandidate(cand, reviewPack, RUBRIC, {}), /inject a model panel/);
});

test("crossModel is true when the panel spans >=2 providers", async () => {
  const panel = [fixedScorer("claude-3-5-sonnet", GOOD), fixedScorer("gpt-4o", GOOD)];
  const res = await score(cand, reviewPack.slice(0, 2), RUBRIC, { panel });
  assert.equal(res.crossModel, true);
  assert.equal(res.verdict, "keep");
});

test("crossModel is false for a single-provider panel", async () => {
  const panel = [fixedScorer("claude-3-5-sonnet", GOOD), fixedScorer("claude-3-opus", GOOD)];
  const res = await score(cand, reviewPack.slice(0, 2), RUBRIC, { panel });
  assert.equal(res.crossModel, false);
});

test("kill-floor forces a cut even when overall clears the threshold", async () => {
  // clarity=2 is below killFloor 4; overall (6.5) is above cut_threshold 5.
  const killed = { resonance: 8, clarity: 2, credibility: 8, scrollStop: 8 };
  const panel = [fixedScorer("claude-x", killed), fixedScorer("gpt-y", killed)];
  const res = await score(cand, reviewPack.slice(0, 1), RUBRIC, { panel });
  assert.ok(res.aggregate.overall >= RUBRIC.cut_threshold);
  assert.equal(res.aggregate.clarity, 2);
  assert.equal(res.verdict, "cut");
});

test("whole-panel failure returns the marked neutral fallback", async () => {
  const panel = [deadClient("claude-x"), deadClient("gpt-y")];
  const res = await score(cand, reviewPack.slice(0, 1), RUBRIC, { panel });
  assert.equal(res.fallback, true);
  assert.equal(res.crossModel, false);
  assert.match(res.scores.byPersona[0].note, /HUMAN REVIEW/);
});

test("score() output is auto-stamped with the honesty caveat (panelist#6)", async () => {
  const panel = [fixedScorer("claude-3-5-sonnet", GOOD), fixedScorer("gpt-4o", GOOD)];
  const res = await score(cand, reviewPack.slice(0, 2), RUBRIC, { panel });
  assert.equal(typeof res.honesty, "string");
  assert.ok(res.honesty.length > 0);
  assert.ok(res.honesty.includes(HONESTY_MARKER));
});

test("neutralFallback output is also stamped with the honesty caveat", async () => {
  const panel = [deadClient("claude-x"), deadClient("gpt-y")];
  const res = await score(cand, reviewPack.slice(0, 1), RUBRIC, { panel });
  assert.equal(res.fallback, true);
  assert.ok(res.honesty.includes(HONESTY_MARKER));
});

test("decideVerdict cuts on low overall and on kill-axis floor", () => {
  assert.equal(decideVerdict({ overall: 4.9, clarity: 9, credibility: 9 }, RUBRIC), "cut");
  assert.equal(decideVerdict({ overall: 7, clarity: 3.5, credibility: 9 }, RUBRIC), "cut");
  assert.equal(decideVerdict({ overall: 7, clarity: 9, credibility: 9 }, RUBRIC), "keep");
});

// ── Tool isolation (panelist#72) ─────────────────────────────────────────────

test("scoreCandidate isolation defaults to [] when deps.tools is omitted", async () => {
  const panel = [fixedScorer("claude-3-5-sonnet", GOOD), fixedScorer("gpt-4o", GOOD)];
  const res = await score(cand, reviewPack.slice(0, 1), RUBRIC, { panel });
  assert.deepEqual(res.isolation, { tools: [], denied: [] });
});

test("scoreCandidate isolation reflects an explicit deps.tools grant", async () => {
  const panel = [fixedScorer("claude-3-5-sonnet", GOOD), fixedScorer("gpt-4o", GOOD)];
  const res = await score(cand, reviewPack.slice(0, 1), RUBRIC, { panel, tools: ["recall"] });
  assert.deepEqual(res.isolation, { tools: ["recall"], denied: [] });
});

test("scoreCandidate throws on a wildcard deps.tools grant instead of silently collapsing to []", async () => {
  const panel = [fixedScorer("claude-3-5-sonnet", GOOD), fixedScorer("gpt-4o", GOOD)];
  await assert.rejects(() => score(cand, reviewPack.slice(0, 1), RUBRIC, { panel, tools: "*" }), /wildcard/);
});
