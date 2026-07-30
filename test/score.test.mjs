import { test } from "node:test";
import assert from "node:assert/strict";
import { score, scoreCandidate, decideVerdict } from "../src/lib/score.mjs";
import { HONESTY_MARKER } from "../src/lib/honesty.mjs";
import { fixedScorer, deadClient, toolAttemptingScorer, capturingScorer } from "./_helpers.mjs";
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

test("whole-panel failure fails CLOSED — the fallback verdict is not a passing 'keep' (panelist#80)", async () => {
  // The bug: neutralFallback assigned 5 to every axis and DERIVED the verdict,
  // but 5 === DEFAULT_CUT_THRESHOLD and decideVerdict cuts only on
  // `overall < cut_threshold`, so a total provider outage returned verdict:"keep"
  // — the pre-filter passed everything. This is the assertion whose absence hid it.
  const panel = [deadClient("claude-x"), deadClient("gpt-y")];
  const res = await score(cand, reviewPack.slice(0, 1), RUBRIC, { panel });
  assert.equal(res.fallback, true);
  assert.notEqual(res.verdict, "keep", "a dead panel must never surface a passing verdict");
  assert.equal(res.verdict, "cut", "the fallback fails closed to 'cut'");
  // Independent of the rubric's threshold: even with cut_threshold at the floor
  // (so a derived 5 would clear it), the pinned verdict must still fail closed.
  const permissive = { ...RUBRIC, cut_threshold: 0 };
  const res2 = await score(cand, reviewPack.slice(0, 1), permissive, { panel });
  assert.equal(res2.verdict, "cut");
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

// The bug (panelist#77): the envelope claimed enforcement that never happened —
// deps.tools was reported as granted but never forwarded to the adapter, and
// `denied` was hardcoded []. These tests assert on what the adapter ACTUALLY
// RECEIVED, not just on the returned envelope — a test reading only the
// envelope would have passed throughout the bug's lifetime.

test("default → denied and recorded: no deps.tools means complete() gets no tools, and an attempt is denied", async () => {
  const panel = [toolAttemptingScorer("claude-x", "recall", GOOD)];
  const res = await score(cand, reviewPack.slice(0, 1), RUBRIC, { panel });
  assert.deepEqual(res.isolation.tools, []);
  assert.equal(res.isolation.denied.length, 1);
  assert.equal(res.isolation.denied[0].tool, "recall");
  assert.match(res.isolation.denied[0].at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

test("explicit allowlist → actually forwarded to the adapter AND permitted", async () => {
  const captured = [];
  const panel = [capturingScorer("claude-x", GOOD, captured)];
  const res = await score(cand, reviewPack.slice(0, 1), RUBRIC, { panel, tools: ["recall"] });
  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0].tools, ["recall"], "complete() must receive the granted tools array");
  assert.deepEqual(res.isolation, { tools: ["recall"], denied: [] });

  // Same allowlist, but the adapter actually reaches for the granted tool —
  // must be permitted (no denial), proving the forwarded array is load-bearing.
  const grantedPanel = [toolAttemptingScorer("claude-x", "recall", GOOD)];
  const grantedRes = await score(cand, reviewPack.slice(0, 1), RUBRIC, { panel: grantedPanel, tools: ["recall"] });
  assert.deepEqual(grantedRes.isolation, { tools: ["recall"], denied: [] });
});

test("heuristic-fallback path still emits {tools:[],denied:[]} even when deps.tools is granted", async () => {
  const panel = [deadClient("claude-x"), deadClient("gpt-y")];
  const res = await score(cand, reviewPack.slice(0, 1), RUBRIC, { panel, tools: ["recall"] });
  assert.equal(res.fallback, true);
  assert.deepEqual(res.isolation, { tools: [], denied: [] });
});

// ── PAN-09: injectable maxTokens/temperature (panelist#85) ──────────────────

test("scoreCandidate forwards default maxTokens (512) and temperature (0) when deps omits them", async () => {
  const captured = [];
  const panel = [capturingScorer("claude-x", GOOD, captured)];
  await score(cand, reviewPack.slice(0, 1), RUBRIC, { panel });
  assert.equal(captured.length, 1);
  assert.equal(captured[0].maxTokens, 512);
  assert.equal(captured[0].temperature, 0);
});

test("scoreCandidate forwards deps.maxTokens/deps.temperature when supplied", async () => {
  const captured = [];
  const panel = [capturingScorer("claude-x", GOOD, captured)];
  await score(cand, reviewPack.slice(0, 1), RUBRIC, { panel, maxTokens: 2048, temperature: 0.7 });
  assert.equal(captured.length, 1);
  assert.equal(captured[0].maxTokens, 2048);
  assert.equal(captured[0].temperature, 0.7);
});

test("scoreCandidate honors an explicit temperature of 0 (nullish, not falsy, coalescing)", async () => {
  const captured = [];
  const panel = [capturingScorer("claude-x", GOOD, captured)];
  await score(cand, reviewPack.slice(0, 1), RUBRIC, { panel, temperature: 0 });
  assert.equal(captured[0].temperature, 0);
});

// ── PAN-16: panel-size + diagnosable failure causes (panelist#85) ───────────

test("panelSize and panelistsReported reflect a fully-successful run", async () => {
  const panel = [fixedScorer("claude-a", GOOD), fixedScorer("gpt-b", GOOD)];
  const res = await score(cand, reviewPack.slice(0, 2), RUBRIC, { panel });
  // 2 personas x 2 panelists = 4 tasks attempted, all reported.
  assert.equal(res.panelSize, 4);
  assert.equal(res.panelistsReported, 4);
  assert.deepEqual(res.failuresByCause, { transport: 0, unparsable: 0 });
});

test("a mixed panel (dead transport + unparsable reply) splits failuresByCause by cause", async () => {
  const unparsableClient = {
    model: "unparsable",
    async complete() {
      return { ok: true, text: "not json at all" };
    },
  };
  const panel = [deadClient("dead"), unparsableClient];
  const res = await score(cand, reviewPack.slice(0, 1), RUBRIC, { panel });
  // 1 persona x 2 panelists = 2 tasks; both fail, none reports a usable score,
  // so this hits the neutralFallback path.
  assert.equal(res.fallback, true);
  assert.equal(res.panelSize, 2);
  assert.equal(res.panelistsReported, 0);
  assert.deepEqual(res.failuresByCause, { transport: 1, unparsable: 1 });
  assert.equal(res.panelistsFailed, 2);
});

test("a partially-failing panel (one good, one dead, one unparsable) reports both live results and the breakdown", async () => {
  const unparsableClient = {
    model: "unparsable",
    async complete() {
      return { ok: true, text: "not json at all" };
    },
  };
  const panel = [fixedScorer("claude-good", GOOD), deadClient("dead"), unparsableClient];
  const res = await score(cand, reviewPack.slice(0, 1), RUBRIC, { panel });
  assert.equal(res.fallback, undefined);
  assert.equal(res.panelSize, 3);
  assert.equal(res.panelistsReported, 1);
  assert.equal(res.panelistsFailed, 2);
  assert.deepEqual(res.failuresByCause, { transport: 1, unparsable: 1 });
});
