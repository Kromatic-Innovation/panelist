import { test } from "node:test";
import assert from "node:assert/strict";
import { score, FAILURE_SAMPLE_LIMIT, FAILURE_REASON_MAX_CHARS } from "../src/lib/score.mjs";

// panelist#249: bounded, redacted failure reasons.

const RUBRIC = { axes: ["resonance", "clarity"], killAxes: [], killFloor: 4, cut_threshold: 5 };
const GOOD = JSON.stringify({ resonance: 8, clarity: 8 });
const cand = { text: "A very secret artifact body." };
const D = { retryDelayMs: 0, retries: 0 };
const ok = (model) => ({ model, complete: async () => ({ ok: true, text: GOOD, model }) });

test("constants are exported", () => {
  assert.equal(FAILURE_SAMPLE_LIMIT, 5);
  assert.equal(FAILURE_REASON_MAX_CHARS, 200);
});

test("throwing adapter and ok:false adapter both appear; counts unchanged", async () => {
  const thrower = { model: "m-throw", complete: async () => { throw new Error("boom: socket hang up"); } };
  const refuser = { model: "m-refuse", complete: async () => ({ ok: false, reason: "rate limited" }) };
  const res = await score(cand, [{ id: "a" }], RUBRIC, { panel: [ok("m-ok"), thrower, refuser], ...D });
  assert.deepEqual(res.failureSample, [
    { persona: "a", model: "m-throw", cause: "transport", reason: "boom: socket hang up" },
    { persona: "a", model: "m-refuse", cause: "transport", reason: "rate limited" },
  ]);
  assert.deepEqual(res.failuresByCause, { transport: 2, unparsable: 0 });
});

test("unparsable reply uses a fixed reason, never the reply text", async () => {
  const bad = { model: "m", complete: async () => ({ ok: true, text: "SECRET REPLY not json" }) };
  const res = await score(cand, [{ id: "a" }], RUBRIC, { panel: [ok("g"), bad], ...D });
  assert.equal(res.failureSample[0].cause, "unparsable");
  assert.equal(res.failureSample[0].reason, "unparsable reply");
  assert.ok(!JSON.stringify(res.failureSample).includes("SECRET REPLY"));
});

test("missing reason and non-string reasons are coerced safely", async () => {
  const mk = (r) => ({ model: "m", complete: async () => ({ ok: false, reason: r }) });
  const panel = [mk(undefined), mk({ message: "obj msg" }), mk({ x: 1 }), mk(42), { model: "t", complete: async () => ({ ok: true, text: 5 }) }];
  const res = await score(cand, [{ id: "a" }], RUBRIC, { panel, ...D });
  assert.deepEqual(res.failureSample.map((f) => f.reason), ["no usable text", "obj msg", "non-string reason", "42", "no usable text"]);
});

test("sample is capped at the limit, in task order", async () => {
  const panel = Array.from({ length: 4 }, (_, i) => ({ model: `m${i}`, complete: async () => ({ ok: false, reason: `r${i}` }) }));
  const res = await score(cand, [{ id: "a" }, { id: "b" }], RUBRIC, { panel, ...D });
  assert.equal(res.panelistsFailed, 8);
  assert.equal(res.failureSample.length, 5);
  assert.deepEqual(res.failureSample.map((f) => `${f.persona}:${f.model}`), ["a:m0", "a:m1", "a:m2", "a:m3", "b:m0"]);
});

test("long reasons are truncated to the max with an ellipsis", async () => {
  const long = { model: "m", complete: async () => ({ ok: false, reason: "x".repeat(500) }) };
  const res = await score(cand, [{ id: "a" }], RUBRIC, { panel: [long], ...D });
  const r = res.failureSample[0].reason;
  assert.equal(r.length, FAILURE_REASON_MAX_CHARS);
  assert.ok(r.endsWith("…"));
});

test("prompt and artifact text echoed in an adapter error are redacted", async () => {
  const echo = {
    model: "m",
    complete: async ({ prompt }) => {
      throw new Error(`bad request for prompt <<${prompt}>> and text <<${cand.text}>>`);
    },
  };
  const res = await score(cand, [{ id: "a" }], RUBRIC, { panel: [echo], ...D, buildPrompt: () => "PROMPT-SENTINEL-123" });
  const r = res.failureSample[0].reason;
  assert.equal(r, "bad request for prompt <<[redacted]>> and text <<[redacted]>>");
  assert.ok(!r.includes("secret artifact"));
});

test("redaction happens before truncation", async () => {
  const big = "Z".repeat(1000);
  const echo = { model: "m", complete: async () => ({ ok: false, reason: `ctx ${big} end` }) };
  const res = await score({ text: big }, [{ id: "a" }], RUBRIC, { panel: [echo], ...D });
  assert.equal(res.failureSample[0].reason, "ctx [redacted] end");
});

test("with retries the reason reflects the FINAL attempt", async () => {
  let n = 0;
  const c = { model: "m", complete: async () => ({ ok: false, reason: `attempt ${++n}` }) };
  const res = await score(cand, [{ id: "a" }], RUBRIC, { panel: [c], retryDelayMs: 0, retries: 2 });
  assert.equal(n, 3);
  assert.equal(res.failureSample.length, 1);
  assert.equal(res.failureSample[0].reason, "attempt 3");
});

test("present and empty on a clean run; present on built-in and custom fallback paths", async () => {
  const clean = await score(cand, [{ id: "a" }], RUBRIC, { panel: [ok("m")], ...D });
  assert.deepEqual(clean.failureSample, []);
  const dead = { model: "m", complete: async () => ({ ok: false, reason: "down" }) };
  const builtin = await score(cand, [{ id: "a" }], RUBRIC, { panel: [dead], ...D });
  assert.equal(builtin.fallback, true);
  assert.equal(builtin.failureSample[0].reason, "down");
  const custom = await score(cand, [{ id: "a" }], RUBRIC, {
    panel: [dead], ...D, fallback: () => ({ aggregate: { overall: 0 }, failureSample: "forged" }),
  });
  assert.equal(custom.failureSample[0].reason, "down");
});
