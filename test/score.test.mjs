import { test } from "node:test";
import assert from "node:assert/strict";
import { score, scoreCandidate, decideVerdict, rankCandidatesWith } from "../src/lib/score.mjs";
import { HONESTY_MARKER } from "../src/lib/honesty.mjs";
import { fixedScorer, deadClient, toolAttemptingScorer, capturingScorer, variableScorer } from "./_helpers.mjs";
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

// ── panelist#144: per-entry temperature/maxTokens override ───────────────

test("a panel entry's own temperature/maxTokens overrides the run-level deps default for that entry only", async () => {
  const capturedA = [];
  const capturedB = [];
  const overridden = { ...capturingScorer("reasoning-model", GOOD, capturedA), temperature: 1, maxTokens: 2048 };
  const plain = capturingScorer("claude-x", GOOD, capturedB);
  await score(cand, reviewPack.slice(0, 1), RUBRIC, { panel: [overridden, plain], temperature: 0, maxTokens: 512 });
  assert.equal(capturedA[0].temperature, 1, "the overriding entry gets its OWN temperature");
  assert.equal(capturedA[0].maxTokens, 2048, "the overriding entry gets its OWN maxTokens");
  assert.equal(capturedB[0].temperature, 0, "the plain entry still gets the run-level default");
  assert.equal(capturedB[0].maxTokens, 512, "the plain entry still gets the run-level default");
});

test("a panel entry may declare temperature: undefined to suppress the field entirely, distinct from omitting the property", async () => {
  const captured = [];
  const suppressed = { ...capturingScorer("reasoning-model", GOOD, captured), temperature: undefined };
  await score(cand, reviewPack.slice(0, 1), RUBRIC, { panel: [suppressed], temperature: 0 });
  assert.equal("temperature" in captured[0], true, "the key is still passed through to complete()");
  assert.equal(captured[0].temperature, undefined, "but its value is undefined, not the run-level 0");
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
  // Verdict polarity on the DERIVED path — the assertion whose absence hid
  // panelist#167. 1 of 3 reporting is below the default quorum, so the panel
  // fails closed regardless of how well the lone survivor scored.
  assert.equal(res.verdict, "cut");
});

// ── Quorum floor (panelist#167) ──────────────────────────────────────────────

/** A panelist that scores a neutral 5 on every axis — the fallback's own value. */
const NEUTRAL = { resonance: 5, clarity: 5, credibility: 5, scrollStop: 5 };
const BAD = { resonance: 2, clarity: 2, credibility: 2, scrollStop: 2 };

test("a lone survivor at panelSize-1 failures fails CLOSED, not 'keep' (panelist#167)", async () => {
  // The bug: with panelistsFailed === panelSize - 1, byPersona.length is 1, so
  // the whole-panel fail-closed pin never applies. The survivor's neutral 5s
  // aggregate to overall 5.0, decideVerdict cuts only on
  // `overall < cut_threshold`, and 5 < 5 is false — so a 2-of-3 provider outage
  // returned verdict:"keep". The same consumer hazard panelist#80 closed,
  // surviving partial attrition instead of total.
  const panel = [fixedScorer("claude-alive", NEUTRAL), deadClient("dead-a"), deadClient("dead-b")];
  const res = await score(cand, reviewPack.slice(0, 1), RUBRIC, { panel });
  assert.equal(res.panelSize, 3);
  assert.equal(res.panelistsReported, 1);
  assert.equal(res.panelistsFailed, res.panelSize - 1);
  assert.equal(res.aggregate.overall, 5, "the survivor's neutral 5s aggregate to exactly the threshold");
  assert.notEqual(res.verdict, "keep", "a panel below quorum must never surface a passing verdict");
  assert.equal(res.verdict, "cut");
  // Not the whole-panel fallback path — the survivor's scores are still reported.
  assert.equal(res.fallback, undefined);
  assert.equal(res.scores.byPersona.length, 1);
  assert.equal(res.quorum.met, false);
  assert.match(res.quorum.note, /HUMAN REVIEW/);
});

test("a lone survivor of a two-panelist panel is also below quorum (panelist#167)", async () => {
  // panelistsFailed === panelSize - 1 holds at n=2 too: the default quorum is a
  // STRICT MAJORITY, so 1 of 2 does not clear it. That is also exactly the case
  // where crossModel silently drops to false — the codebase already treats a
  // single-provider result as degraded.
  const panel = [fixedScorer("claude-alive", GOOD), deadClient("dead-a")];
  const res = await score(cand, reviewPack.slice(0, 1), RUBRIC, { panel });
  assert.equal(res.panelSize, 2);
  assert.equal(res.panelistsReported, 1);
  assert.equal(res.verdict, "cut", "1 of 2 is not a majority");
  assert.equal(res.quorum.met, false);
});

test("a deliberately-configured single-panelist panel still derives its verdict (panelist#167)", async () => {
  // Quorum is about UNEXPECTED attrition, not panel size: 1 of 1 reporting is a
  // FULL panel, so the verdict stays derived — in both directions.
  const keepRes = await score(cand, reviewPack.slice(0, 1), RUBRIC, {
    panel: [fixedScorer("claude-solo", GOOD)],
  });
  assert.equal(keepRes.panelSize, 1);
  assert.equal(keepRes.panelistsReported, 1);
  assert.equal(keepRes.quorum.met, true);
  assert.equal(keepRes.verdict, "keep");

  const cutRes = await score(cand, reviewPack.slice(0, 1), RUBRIC, {
    panel: [fixedScorer("claude-solo", BAD)],
  });
  assert.equal(cutRes.quorum.met, true);
  assert.equal(cutRes.verdict, "cut");
});

test("a panel that MEETS quorum keeps its derived verdict unchanged (panelist#167)", async () => {
  // 2 of 3 is a majority; the derived verdict applies exactly as before.
  const panel = [fixedScorer("claude-a", GOOD), fixedScorer("gpt-b", GOOD), deadClient("dead")];
  const res = await score(cand, reviewPack.slice(0, 1), RUBRIC, { panel });
  assert.equal(res.panelistsReported, 2);
  assert.equal(res.panelSize, 3);
  assert.equal(res.quorum.met, true);
  assert.equal(res.verdict, "keep");
});

test("rubric.quorum is configurable through the normalization path (panelist#167)", async () => {
  const panel = [fixedScorer("claude-alive", GOOD), deadClient("dead-a"), deadClient("dead-b")];
  // quorum: 0 opts out of the floor entirely — a caller who genuinely wants a
  // lone-survivor result can have one.
  const optedOut = await score(cand, reviewPack.slice(0, 1), { ...RUBRIC, quorum: 0 }, { panel });
  assert.equal(optedOut.quorum.required, 1);
  assert.equal(optedOut.quorum.met, true);
  assert.equal(optedOut.verdict, "keep");

  // quorum: 1 demands the WHOLE panel report.
  const strictPanel = [fixedScorer("claude-a", GOOD), fixedScorer("gpt-b", GOOD), deadClient("dead")];
  const strict = await score(cand, reviewPack.slice(0, 1), { ...RUBRIC, quorum: 1 }, { panel: strictPanel });
  assert.equal(strict.quorum.required, 3);
  assert.equal(strict.quorum.met, false);
  assert.equal(strict.verdict, "cut");
});

test("quorum: 0 cannot reopen the whole-panel fail-open (panelist#80 stays closed)", async () => {
  const panel = [deadClient("dead-a"), deadClient("dead-b")];
  const res = await score(cand, reviewPack.slice(0, 1), { ...RUBRIC, quorum: 0, cut_threshold: 0 }, { panel });
  assert.equal(res.fallback, true);
  assert.equal(res.verdict, "cut");
});

// ── panelist#176: pin the deps.fallback verdict channel ─────────────────────

test("a custom deps.fallback returning verdict:'keep' on a dead panel is pinned to 'cut' (panelist#176)", async () => {
  const panel = [deadClient("claude-x"), deadClient("gpt-y")];
  const customFallback = (candidate) => ({
    candidate,
    scores: { byPersona: [], byModel: {} },
    aggregate: { overall: 9 },
    verdict: "keep",
    fallback: true,
  });
  const res = await score(cand, reviewPack.slice(0, 1), RUBRIC, { panel, fallback: customFallback });
  assert.equal(res.verdict, "cut");
});

test("a custom deps.fallback omitting verdict entirely is pinned to 'cut' (panelist#176)", async () => {
  const panel = [deadClient("claude-x"), deadClient("gpt-y")];
  const customFallback = (candidate) => ({
    candidate,
    scores: { byPersona: [], byModel: {} },
    aggregate: { overall: 0 },
    fallback: true,
  });
  const res = await score(cand, reviewPack.slice(0, 1), RUBRIC, { panel, fallback: customFallback });
  assert.equal(res.verdict, "cut");
});

test("a custom deps.fallback returning an off-vocabulary verdict is pinned to 'cut' (panelist#176)", async () => {
  const panel = [deadClient("claude-x"), deadClient("gpt-y")];
  const customFallback = (candidate) => ({
    candidate,
    scores: { byPersona: [], byModel: {} },
    aggregate: { overall: 0 },
    verdict: "maybe",
    fallback: true,
  });
  const res = await score(cand, reviewPack.slice(0, 1), RUBRIC, { panel, fallback: customFallback });
  assert.equal(res.verdict, "cut");
});

test("the pin touches verdict only — every other custom-fallback field survives untouched (panelist#176 AC2)", async () => {
  const panel = [deadClient("claude-x"), deadClient("gpt-y")];
  const customFallback = (candidate, panelistsFailed) => ({
    candidate,
    scores: { byPersona: [], byModel: {} },
    aggregate: { overall: 0 },
    verdict: "keep",
    note: "custom note",
    fallback: true,
    custom: true,
    panelistsFailed,
  });
  const res = await score(cand, reviewPack.slice(0, 1), RUBRIC, { panel, fallback: customFallback });
  assert.equal(res.verdict, "cut");
  assert.equal(res.note, "custom note");
  assert.equal(res.custom, true);
  assert.equal(res.fallback, true);
  assert.deepEqual(res.scores, { byPersona: [], byModel: {} });
});

test("through rankCandidatesWith, the pinned candidate lands in cut (not neither list) and a fallback omitting aggregate does not throw (panelist#176 AC3)", async () => {
  const panel = [deadClient("claude-x"), deadClient("gpt-y")];
  const customFallback = (candidate) => ({
    candidate,
    scores: { byPersona: [], byModel: {} },
    // Deliberately no `aggregate` and no `verdict` — the vanishing/crashing
    // shape this issue closes.
  });
  const result = await rankCandidatesWith([cand], reviewPack.slice(0, 1), RUBRIC, { panel, fallback: customFallback });
  assert.equal(result.shortlist.length, 0);
  assert.equal(result.cut.length, 1);
  assert.equal(result.cut[0].evaluation.verdict, "cut");
  assert.equal(result.cut[0].evaluation.aggregate.overall, 0);
});

// ── panelist#179: the degraded-panel invariant, independent of which path
// produced the degradation ───────────────────────────────────────────────────
//
// panelist#80 (total outage), panelist#167 (partial attrition), and
// panelist#176 (the deps.fallback channel) were the same defect in one
// function, found three times: nothing
// asserted "a degraded panel never yields keep" independent of which path
// produced the degradation — every prior assertion was a point test against
// one path. This table walks personas 1..4 x panelists 1..4 x panelist
// failures 0..panelists (a dead panelist costs every persona's task against
// it, matching the real "a provider dies" shape) and asserts the invariant
// through score()'s PUBLIC output only (quorum.required, quorum.met,
// panelistsReported, verdict, aggregate) — never by re-deriving the
// quorumRequired arithmetic — so it survives a future refactor of that
// function (issue AC5).

test("panelist#179 AC2: 4 personas x 2 panelists, one provider dying costs 4 tasks and required is 5", async () => {
  // The concrete shape the issue names. required=5 is a deliberately
  // hardcoded expectation for this ONE named case (AC2) — the general matrix
  // below does not recompute this arithmetic.
  const panel = [fixedScorer("panelist-a", GOOD), deadClient("panelist-b")];
  const res = await score(cand, reviewPack.slice(0, 4), RUBRIC, { panel });
  assert.equal(res.panelSize, 8);
  assert.equal(res.panelistsReported, 4);
  assert.equal(res.quorum.required, 5);
  assert.equal(res.quorum.met, false);
  // Intended fail-closed behavior — what an operator meets first on a bad
  // provider hour. Asserted as expected, not treated as a finding.
  assert.equal(res.verdict, "cut");
});

const MATRIX_PERSONA_COUNTS = [1, 2, 3, 4];
const MATRIX_PANELIST_COUNTS = [1, 2, 3, 4];

for (const personaCount of MATRIX_PERSONA_COUNTS) {
  for (const panelistCount of MATRIX_PANELIST_COUNTS) {
    for (let deadCount = 0; deadCount <= panelistCount; deadCount++) {
      const label = `${personaCount} persona(s) x ${panelistCount} panelist(s), ${deadCount}/${panelistCount} dead`;
      test(`degraded-panel invariant: ${label} (panelist#179)`, async () => {
        const personas = reviewPack.slice(0, personaCount);
        const panel = [];
        for (let i = 0; i < panelistCount; i++) {
          panel.push(i < deadCount ? deadClient(`dead-${i}`) : fixedScorer(`alive-${i}`, GOOD));
        }
        const res = await score(cand, personas, RUBRIC, { panel });

        if (res.panelistsReported === 0) {
          // Total-outage path (panelist#80's pin): zero panelists reporting
          // must never surface a passing verdict, for any personas x
          // panelists shape.
          assert.equal(res.verdict, "cut");
        } else if (res.panelistsReported < res.quorum.required) {
          // Partial-attrition path (panelist#167's pin): below the quorum
          // floor the verdict must never be derived, regardless of shape.
          assert.notEqual(res.verdict, "keep");
          assert.equal(res.verdict, "cut");
        }
        if (res.quorum.met === true) {
          // At/above quorum the verdict must still be exactly what
          // decideVerdict derives from the public aggregate — quorum being
          // met changes nothing about how the verdict is computed.
          assert.equal(res.verdict, decideVerdict(res.aggregate, RUBRIC));
        }
      });
    }
  }
}

// Total-outage path, explicitly, WITH a custom deps.fallback that attempts
// "keep" — the same table shape as above, but proving the fallback channel
// pin (panelist#176) can't be bypassed by any personas x panelists shape,
// not just the shape panelist#176's own regression test used.
for (const personaCount of MATRIX_PERSONA_COUNTS) {
  test(`degraded-panel invariant: total outage, ${personaCount} persona(s), custom fallback attempts "keep" (panelist#179)`, async () => {
    const personas = reviewPack.slice(0, personaCount);
    const panel = [deadClient("dead-a"), deadClient("dead-b")];
    const customFallback = (candidate) => ({
      candidate,
      scores: { byPersona: [], byModel: {} },
      aggregate: { overall: 9 },
      verdict: "keep",
      fallback: true,
    });
    const res = await score(cand, personas, RUBRIC, { panel, fallback: customFallback });
    // A custom deps.fallback replaces neutralFallback wholesale and is under
    // no obligation to emit panelistsReported/quorum (see score.mjs's own
    // comment on this) — but the pin is unconditional either way.
    assert.equal(res.verdict, "cut");
  });
}

test("rankCandidatesWith: a below-quorum candidate lands in cut (not neither list), other candidates rank normally (panelist#179 AC3)", async () => {
  const BELOW = { text: "BELOW_QUORUM_MARKER candidate" };
  const HIGH = { text: "HIGH_MARKER candidate" };
  const MID = { text: "MID_MARKER candidate" };
  const HIGH_SCORES = { resonance: 9, clarity: 9, credibility: 9, scrollStop: 9 };
  const MID_SCORES = { resonance: 6, clarity: 6, credibility: 6, scrollStop: 6 };

  // panelistA reports for every candidate; panelistB fails ONLY for BELOW's
  // prompts (matched via its marker text) — the same shared deps.panel array
  // is reused across all three candidates in the rankCandidatesWith call, so
  // this is what makes BELOW's calls fail while HIGH/MID's succeed on the
  // identical client objects. 4 personas x 2 panelists = 8 tasks; BELOW gets
  // only 4 (1 surviving panelist), below quorumRequired(8, 0.5) = 5.
  const panelistA = variableScorer("panelist-a", (prompt) => {
    if (prompt.includes("HIGH_MARKER")) return HIGH_SCORES;
    if (prompt.includes("MID_MARKER")) return MID_SCORES;
    return GOOD;
  });
  const panelistB = variableScorer("panelist-b", (prompt) => {
    if (prompt.includes("BELOW_QUORUM_MARKER")) return null;
    if (prompt.includes("HIGH_MARKER")) return HIGH_SCORES;
    if (prompt.includes("MID_MARKER")) return MID_SCORES;
    return GOOD;
  });

  const result = await rankCandidatesWith([BELOW, HIGH, MID], reviewPack.slice(0, 4), RUBRIC, {
    panel: [panelistA, panelistB],
  });

  const belowEntry = [...result.shortlist, ...result.cut].find((e) => e.text === BELOW.text);
  assert.ok(belowEntry, "below-quorum candidate must land in one of the two lists, not vanish");
  assert.equal(
    result.cut.some((e) => e.text === BELOW.text),
    true,
    "below-quorum candidate must land in cut, not shortlist",
  );
  assert.equal(belowEntry.evaluation.panelistsReported, 4);
  assert.equal(belowEntry.evaluation.quorum.met, false);
  assert.equal(belowEntry.evaluation.verdict, "cut");

  // The other two candidates both meet quorum and rank normally by score.
  const highEntry = result.shortlist.find((e) => e.text === HIGH.text);
  const midEntry = result.shortlist.find((e) => e.text === MID.text);
  assert.ok(highEntry && midEntry, "full-quorum candidates land in shortlist");
  assert.equal(highEntry.evaluation.quorum.met, true);
  assert.equal(midEntry.evaluation.quorum.met, true);
  assert.equal(highEntry.evaluation.verdict, "keep");
  assert.equal(midEntry.evaluation.verdict, "keep");
  assert.ok(highEntry.rank < midEntry.rank, "the higher-scoring candidate ranks first");
});
