import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  score,
  decideVerdict,
  normalizeRubric,
  extractJsonObject,
  extractScore,
} from "../src/lib/score.mjs";
import { spawn } from "../src/lib/spawn.mjs";
import { createToolGate } from "../src/lib/isolation.mjs";
import { registerPersonas, clearRegistry } from "../src/lib/register.mjs";
import { fixedScorer, toolAttemptingClient } from "./_helpers.mjs";
import reviewPack from "../packs/review/index.mjs";

// panelist#250: pins for branches a 23-mutant probe showed no test distinguished.

const cand = { text: "An artifact under review." };
const P = [{ id: "a" }];
const NO_RETRY = { retries: 0 };

beforeEach(() => {
  clearRegistry();
  registerPersonas(reviewPack);
});

// ── cut_threshold boundary ───────────────────────────────────────────────────

test("cut_threshold boundary: overall == threshold keeps, just below cuts", async () => {
  const rubric = { axes: ["resonance", "clarity"], killAxes: [], killFloor: 0, cut_threshold: 5 };
  assert.equal(decideVerdict({ resonance: 5, clarity: 5, overall: 5 }, rubric), "keep");
  assert.equal(decideVerdict({ resonance: 5, clarity: 4.99, overall: 4.99 }, rubric), "cut");
  const at = await score(cand, P, rubric, { panel: [fixedScorer("m", { resonance: 5, clarity: 5 })], ...NO_RETRY });
  assert.equal(at.aggregate.overall, 5);
  assert.equal(at.verdict, "keep");
  const below = await score(cand, P, rubric, { panel: [fixedScorer("m", { resonance: 5, clarity: 4 })], ...NO_RETRY });
  assert.equal(below.aggregate.overall, 4.5);
  assert.equal(below.verdict, "cut");
});

// ── killFloor boundary ───────────────────────────────────────────────────────

test("killFloor boundary: kill axis == floor keeps, just below cuts", async () => {
  const rubric = { axes: ["resonance", "clarity"], killAxes: ["clarity"], killFloor: 4, cut_threshold: 1 };
  assert.equal(decideVerdict({ resonance: 9, clarity: 4, overall: 6.5 }, rubric), "keep");
  assert.equal(decideVerdict({ resonance: 9, clarity: 3.99, overall: 6.5 }, rubric), "cut");
  const at = await score(cand, P, rubric, { panel: [fixedScorer("m", { resonance: 9, clarity: 4 })], ...NO_RETRY });
  assert.equal(at.verdict, "keep");
  const below = await score(cand, P, rubric, { panel: [fixedScorer("m", { resonance: 9, clarity: 3 })], ...NO_RETRY });
  assert.equal(below.verdict, "cut");
});

// ── missing axis aggregates to null (not 0, not 10) ──────────────────────────

test("an axis no reply scored aggregates to exactly null, is listed in axesMissing, and does not skew overall", async () => {
  const rubric = { axes: ["resonance", "clarity"], killAxes: [], killFloor: 4, cut_threshold: 5 };
  const res = await score(cand, P, rubric, { panel: [fixedScorer("m", { resonance: 8 })], ...NO_RETRY });
  assert.equal(res.aggregate.clarity, null);
  assert.deepEqual(res.axesMissing, ["clarity"]);
  assert.equal(res.aggregate.resonance, 8);
  // overall is the mean of the PRESENT axes only: a 0 or 10 stand-in would move it.
  assert.equal(res.aggregate.overall, 8);
  assert.equal(res.verdict, "keep");
});

// ── sliceBalanced: escaped quote inside a JSON string ────────────────────────

test("a JSON object with an escaped quote and brace in a string, wrapped in prose, still extracts", () => {
  const text = String.raw`Sure, here is my score: {"resonance": 7, "clarity": 6, "note": "he said \"hi}\" and left"} hope that helps.`;
  const obj = extractJsonObject(text);
  assert.ok(obj, "balanced slice must survive the escaped quote");
  assert.equal(obj.note, 'he said "hi}" and left');
  const s = extractScore(text, ["resonance", "clarity"]);
  assert.equal(s.resonance, 7);
  assert.equal(s.clarity, 6);
  assert.equal(s.note, 'he said "hi}" and left');
});

// ── tool allowlist actually forwarded ────────────────────────────────────────

test("spawn forwards the GATED allowlist to the adapter, not the raw opts.tools", async () => {
  const seen = [];
  const client = {
    model: "m",
    async complete(args) {
      seen.push(args.tools);
      return { ok: true, text: JSON.stringify({ message: "ok", dealKillers: [] }), model: "m" };
    },
  };
  const base = { mode: "comment", artifact: "x" };
  // Shared gate grants only "a" while the caller asks for ["a","b"].
  const out = await spawn("drive-by-installer", { ...base, tools: ["a", "b"] }, { client, toolGate: createToolGate({ tools: ["a"] }) });
  assert.deepEqual(seen[0], ["a"]);
  assert.deepEqual(out.isolation.tools, ["a"]);
  // Own gate: raw tools are normalized (trim + dedupe)...
  await spawn("drive-by-installer", { ...base, tools: [" a ", "a", "b"] }, { client });
  assert.deepEqual(seen[1], ["a", "b"]);
  // ...and omitted means deny-by-default [] (never undefined).
  await spawn("drive-by-installer", base, { client });
  assert.deepEqual(seen[2], []);
  // A tool the gate does not grant is reported as denied by a gate-honouring adapter.
  const denying = toolAttemptingClient("m", "b", { message: "ok", dealKillers: [] });
  const d = await spawn("drive-by-installer", { ...base, tools: ["a", "b"] }, { client: denying, toolGate: createToolGate({ tools: ["a"] }) });
  assert.deepEqual(d.isolation.denied.map((e) => e.tool), ["b"]);
});

test("score forwards the GATED allowlist to every panelist, not the raw deps.tools", async () => {
  const rubric = { axes: ["resonance", "clarity"], killAxes: [], killFloor: 4, cut_threshold: 5 };
  const seen = [];
  const panelist = {
    model: "m",
    async complete(args) {
      seen.push(args.tools);
      return { ok: true, text: JSON.stringify({ resonance: 7, clarity: 7 }), model: "m" };
    },
  };
  const res = await score(cand, P, rubric, { panel: [panelist], tools: ["a", "b"], toolGate: createToolGate({ tools: ["a"] }), ...NO_RETRY });
  assert.deepEqual(seen[0], ["a"]);
  assert.deepEqual(res.isolation.tools, ["a"]);
  await score(cand, P, rubric, { panel: [panelist], tools: [" a ", "a", "b"], ...NO_RETRY });
  assert.deepEqual(seen[1], ["a", "b"]);
  await score(cand, P, rubric, { panel: [panelist], ...NO_RETRY });
  assert.deepEqual(seen[2], []);
});

// ── byPersona[].model is the adapter-reported id ─────────────────────────────

test("byPersona[].model and byModel use the adapter-reported model id, falling back to the requested one", async () => {
  const rubric = { axes: ["resonance", "clarity"], killAxes: [], killFloor: 4, cut_threshold: 5 };
  const reporting = {
    model: "requested-model",
    async complete() {
      return { ok: true, text: JSON.stringify({ resonance: 7, clarity: 7 }), model: "served-model" };
    },
  };
  const res = await score(cand, P, rubric, { panel: [reporting], ...NO_RETRY });
  assert.equal(res.scores.byPersona[0].model, "served-model");
  assert.deepEqual(Object.keys(res.scores.byModel), ["served-model"]);
  const silent = {
    model: "requested-model",
    async complete() {
      return { ok: true, text: JSON.stringify({ resonance: 7, clarity: 7 }) };
    },
  };
  const res2 = await score(cand, P, rubric, { panel: [silent], ...NO_RETRY });
  assert.equal(res2.scores.byPersona[0].model, "requested-model");
});

// ── kill-axis validation (panelist#244) and null kill axis (panelist#247) ────

test("an unknown killAxes entry throws; a kill axis with a null aggregate does not cut", async () => {
  assert.throws(() => normalizeRubric({ axes: ["resonance"], killAxes: ["nope"] }), /killAxes entry "nope"/);
  assert.throws(() => decideVerdict({ overall: 9 }, { axes: ["resonance"], killAxes: ["nope"] }), /killAxes entry/);
  await assert.rejects(
    score(cand, P, { axes: ["resonance"], killAxes: ["nope"] }, { panel: [fixedScorer("m", { resonance: 9 })], ...NO_RETRY }),
    /killAxes entry "nope"/,
  );
  const rubric = { axes: ["resonance", "clarity"], killAxes: ["clarity"], killFloor: 4, cut_threshold: 5 };
  // Missing (null) is not "below the floor": null < 4 is true in JS, so the guard must hold.
  assert.equal(decideVerdict({ resonance: 8, clarity: null, overall: 8 }, rubric), "keep");
  const res = await score(cand, P, rubric, { panel: [fixedScorer("m", { resonance: 8 })], ...NO_RETRY });
  assert.equal(res.aggregate.clarity, null);
  assert.equal(res.verdict, "keep");
  // A scored kill axis below the floor still cuts.
  assert.equal(decideVerdict({ resonance: 8, clarity: 3, overall: 5.5 }, rubric), "cut");
});
