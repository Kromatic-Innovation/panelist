import { test } from "node:test";
import assert from "node:assert/strict";
import { score, rankCandidatesWith } from "../src/lib/score.mjs";
import { fixedScorer, deadClient } from "./_helpers.mjs";

// panelist#246: bounded retries + complete/incompleteReason.

const RUBRIC = { axes: ["resonance", "clarity"], killAxes: [], killFloor: 4, cut_threshold: 5 };
const GOOD = { resonance: 8, clarity: 8 };
const cand = { text: "An artifact under review." };
const PERSONAS = [{ id: "a" }, { id: "b" }];
const D = { retryDelayMs: 0 };

/** Fails the first `failures` calls (per client), then answers GOOD. Counts calls. */
function flaky(model, failures, mode = "transport") {
  const c = { model, calls: 0 };
  c.complete = async () => {
    c.calls++;
    if (c.calls <= failures) return mode === "transport" ? { ok: false, reason: "x" } : { ok: true, text: "not json" };
    return { ok: true, text: JSON.stringify(GOOD), model };
  };
  return c;
}
function counting(client) {
  const c = { model: client.model, calls: 0 };
  c.complete = async (a) => {
    c.calls++;
    return client.complete(a);
  };
  return c;
}

test("a transient failure that succeeds on retry yields a complete result", async () => {
  for (const mode of ["transport", "unparsable"]) {
    const p = flaky("claude-x", 1, mode);
    const res = await score(cand, [{ id: "a" }], RUBRIC, { panel: [p], ...D });
    assert.equal(res.complete, true);
    assert.equal(res.incompleteReason, null);
    assert.equal(res.panelistsFailed, 0);
    assert.equal(res.verdictReason, "score");
    assert.equal(res.attempts, 2);
    assert.equal(p.calls, 2);
  }
});

test("a thrown error is retried too", async () => {
  let n = 0;
  const p = {
    model: "claude-x",
    async complete() {
      if (n++ === 0) throw new Error("boom");
      return { ok: true, text: JSON.stringify(GOOD) };
    },
  };
  const res = await score(cand, [{ id: "a" }], RUBRIC, { panel: [p], ...D });
  assert.equal(res.complete, true);
  assert.equal(n, 2);
});

test("persistent failure on some cells: complete:false, partial, counts are per cell", async () => {
  const good = counting(fixedScorer("claude-g", GOOD));
  const good2 = counting(fixedScorer("gemini-g", GOOD));
  const dead = counting(deadClient("gpt-d"));
  const res = await score(cand, PERSONAS, RUBRIC, { panel: [good, good2, dead], ...D });
  assert.equal(res.complete, false);
  assert.equal(res.incompleteReason, "partial");
  assert.equal(res.verdictReason, "score");
  assert.equal(res.panelistsFailed, 2);
  assert.deepEqual(res.failuresByCause, { transport: 2, unparsable: 0 });
  assert.equal(good.calls, 2);
  assert.equal(dead.calls, 6); // 2 cells x 3 attempts
  assert.equal(res.attempts, 10);
});

test("below quorum after retries: incompleteReason below-quorum, cut", async () => {
  const res = await score(cand, [{ id: "a" }], RUBRIC, {
    panel: [fixedScorer("claude-g", GOOD), deadClient("d1"), deadClient("d2")],
    ...D,
  });
  assert.equal(res.verdict, "cut");
  assert.equal(res.verdictReason, "below-quorum");
  assert.equal(res.complete, false);
  assert.equal(res.incompleteReason, "below-quorum");
});

test("total outage: cut with incompleteReason total-outage (built-in and custom fallback)", async () => {
  const panel = [deadClient("a"), deadClient("b")];
  const built = await score(cand, PERSONAS, RUBRIC, { panel, ...D });
  assert.equal(built.verdict, "cut");
  assert.equal(built.complete, false);
  assert.equal(built.incompleteReason, "total-outage");
  assert.equal(built.attempts, 12);
  const custom = await score(cand, PERSONAS, RUBRIC, {
    panel,
    ...D,
    fallback: () => ({ verdict: "keep", complete: true, incompleteReason: null }),
  });
  assert.equal(custom.complete, false);
  assert.equal(custom.incompleteReason, "total-outage");
});

test("a fully healthy panel is complete with no retries", async () => {
  const p = counting(fixedScorer("claude-g", GOOD));
  const res = await score(cand, PERSONAS, RUBRIC, { panel: [p], ...D });
  assert.equal(res.complete, true);
  assert.equal(res.incompleteReason, null);
  assert.equal(p.calls, 2);
  assert.equal(res.attempts, 2);
});

test("the retry bound is respected exactly, including retries:0 and invalid values", async () => {
  const cases = [
    [undefined, 3],
    [0, 1],
    [1, 2],
    [4, 5],
    [-1, 3],
    [1.5, 3],
    ["2", 3],
    [NaN, 3],
  ];
  for (const [retries, expected] of cases) {
    const d = counting(deadClient("dead"));
    const res = await score(cand, [{ id: "a" }], RUBRIC, { panel: [d], retries, retryDelayMs: 0 });
    assert.equal(d.calls, expected, `retries=${String(retries)}`);
    assert.equal(res.attempts, expected);
    assert.equal(res.panelistsFailed, 1);
  }
});

test("an invalid retryDelayMs never throws", async () => {
  const res = await score(cand, [{ id: "a" }], RUBRIC, { panel: [flaky("m", 0)], retryDelayMs: "soon" });
  assert.equal(res.complete, true);
});

test("backoff is exponential and applied between attempts", async () => {
  const d = counting(deadClient("dead"));
  const t0 = Date.now();
  await score(cand, [{ id: "a" }], RUBRIC, { panel: [d], retries: 2, retryDelayMs: 20 });
  assert.ok(Date.now() - t0 >= 55, "waited ~20ms + ~40ms");
});

test("the limiter is respected with retries: in-flight never exceeds concurrency", async () => {
  let inflight = 0;
  let max = 0;
  const panel = ["m1", "m2", "m3"].map((model) => ({
    model,
    async complete() {
      inflight++;
      max = Math.max(max, inflight);
      await new Promise((r) => setTimeout(r, 2));
      inflight--;
      return { ok: false, reason: "x" };
    },
  }));
  const res = await score(cand, PERSONAS, RUBRIC, { panel, concurrency: 2, retries: 2, retryDelayMs: 5 });
  assert.equal(res.attempts, 18);
  assert.ok(max <= 2, `max in flight ${max}`);
  assert.ok(max >= 1);
});

test("rankCandidatesWith: shared limiter holds with retries and results carry completeness", async () => {
  let inflight = 0;
  let max = 0;
  const panel = [
    {
      model: "claude-g",
      async complete() {
        inflight++;
        max = Math.max(max, inflight);
        await new Promise((r) => setTimeout(r, 1));
        inflight--;
        return { ok: false, reason: "x" };
      },
    },
  ];
  const out = await rankCandidatesWith([{ text: "one" }, { text: "two" }], PERSONAS, RUBRIC, {
    panel,
    concurrency: 2,
    retries: 1,
    retryDelayMs: 0,
  });
  assert.ok(max <= 2, `max in flight ${max}`);
  const all = [...out.shortlist, ...out.cut];
  assert.equal(all.length, 2);
  for (const e of all) {
    assert.equal(e.evaluation.complete, false);
    assert.equal(e.evaluation.incompleteReason, "total-outage");
  }
});
