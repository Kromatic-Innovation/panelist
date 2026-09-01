// Direct unit tests for the public re-exports of src/lib/score.mjs that
// score.test.mjs only covered incidentally through scoreCandidate/decideVerdict.
// Surfaced by the Zenodotus release-readiness panel (#14): the robust-parse
// contract (extractJsonObject/extractScore) and the cross-model provider table
// (providerOf) are exactly the code that silently regresses, so they get
// dedicated coverage here.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createLimiter,
  normalizeRubric,
  renderPersona,
  buildEvalPrompt,
  extractJsonObject,
  extractScore,
  providerOf,
  rankCandidatesWith,
} from "../src/lib/score.mjs";
import { fixedScorer } from "./_helpers.mjs";
import reviewPack from "../packs/review/index.mjs";

// ── providerOf: the cross-model guarantee depends on this mapping ─────────────

test("providerOf buckets known model ids to their provider", () => {
  assert.equal(providerOf("claude-3-5-sonnet"), "anthropic");
  assert.equal(providerOf("anthropic.claude-v2"), "anthropic");
  assert.equal(providerOf("gpt-4o"), "openai");
  assert.equal(providerOf("openai/o1-preview"), "openai");
  assert.equal(providerOf("o3-mini"), "openai");
  assert.equal(providerOf("gemini-1.5-pro"), "google");
  assert.equal(providerOf("google/gemini-flash"), "google");
});

test("providerOf is case-insensitive", () => {
  assert.equal(providerOf("CLAUDE-3-OPUS"), "anthropic");
  assert.equal(providerOf("GPT-4"), "openai");
});

test("providerOf falls back to the lowercased id, then 'unknown'", () => {
  assert.equal(providerOf("mistral-large"), "mistral-large");
  assert.equal(providerOf(""), "unknown");
  assert.equal(providerOf(null), "unknown");
  assert.equal(providerOf(undefined), "unknown");
});

// ── extractJsonObject: tolerate fences and surrounding prose ──────────────────

test("extractJsonObject parses a bare JSON object", () => {
  assert.deepEqual(extractJsonObject('{"a":1,"b":"x"}'), { a: 1, b: "x" });
});

test("extractJsonObject strips ```json fences", () => {
  const text = 'Here you go:\n```json\n{"score": 7}\n```\nthanks';
  assert.deepEqual(extractJsonObject(text), { score: 7 });
});

test("extractJsonObject slices a balanced object out of surrounding prose", () => {
  const text = 'The verdict is { "resonance": 8, "note": "has a }" } — done.';
  assert.deepEqual(extractJsonObject(text), { resonance: 8, note: "has a }" });
});

test("extractJsonObject returns null on unusable input", () => {
  assert.equal(extractJsonObject(""), null);
  assert.equal(extractJsonObject("   "), null);
  assert.equal(extractJsonObject("no json here at all"), null);
  assert.equal(extractJsonObject(42), null);
});

// ── extractJsonObject: fence-regex ReDoS regression (panelist#122, CodeQL alert 10)
// The fence regex used to carry an ambiguous `\s*` before its lazy group, which
// backtracked polynomially on an unterminated fence followed by a long
// whitespace run. These pin the extraction paths that must keep working plus
// the timing bound the fix buys.

test("extractJsonObject: json-tagged fence", () => {
  assert.deepEqual(extractJsonObject('```json\n{"a":1}\n```'), { a: 1 });
});

test("extractJsonObject: untagged fence", () => {
  assert.deepEqual(extractJsonObject('```\n{"a":1}\n```'), { a: 1 });
});

test("extractJsonObject: blank lines and spaces after the opening fence", () => {
  assert.deepEqual(extractJsonObject('```json   \n\n\n   {"a":1}\n\n```'), { a: 1 });
  assert.deepEqual(extractJsonObject('```\n\n  \n{"a":1}\n```'), { a: 1 });
});

test("extractJsonObject: bare object with no fence", () => {
  assert.deepEqual(extractJsonObject('{"a":1}'), { a: 1 });
});

test("extractJsonObject: unterminated fence with a long whitespace run completes fast", () => {
  // The trailing "x" matters: extractJsonObject trims its input first, so a run
  // of whitespace at the very end would be stripped before the regex ever saw
  // it and the test would pass even against the vulnerable pattern.
  const evil = "```json" + " ".repeat(50_000) + "x";
  const started = performance.now();
  const got = extractJsonObject(evil);
  const elapsedMs = performance.now() - started;
  assert.equal(got, null);
  // Sub-millisecond in practice (~0.25ms); the vulnerable regex took ~280ms at
  // this size. The bound has to sit BETWEEN those two or it fails to guard
  // anything: 50ms is ~200x headroom over the fixed path and ~5.6x below the
  // vulnerable one, so it cannot flake on a loaded runner yet still goes red if
  // the ambiguous `\s*` is ever reintroduced (verified by putting it back).
  assert.ok(elapsedMs < 50, `extraction took ${elapsedMs.toFixed(1)}ms`);
});

test("extractScore ignores a bare JSON array (no axis keys to read)", () => {
  // extractJsonObject accepts any typeof-object (arrays included), but extractScore
  // then finds no requested axis on an array and correctly yields null.
  assert.equal(extractScore("[1,2,3]", ["resonance"]), null);
});

// ── extractScore: clamp axes, require at least one, keep note ─────────────────

test("extractScore pulls and clamps the requested axes", () => {
  const out = extractScore('{"resonance": 12, "clarity": -3, "note": " tidy "}', [
    "resonance",
    "clarity",
  ]);
  assert.equal(out.resonance, 10); // clamped to max
  assert.equal(out.clarity, 0); // clamped to min
  assert.equal(out.note, "tidy"); // trimmed
});

test("extractScore coerces numeric strings and nulls missing axes", () => {
  const out = extractScore('{"resonance": "7"}', ["resonance", "clarity"]);
  assert.equal(out.resonance, 7);
  assert.equal(out.clarity, null);
  assert.equal(out.note, "");
});

test("extractScore returns null when no requested axis is present", () => {
  assert.equal(extractScore('{"unrelated": 5}', ["resonance"]), null);
  assert.equal(extractScore("garbage", ["resonance"]), null);
});

// ── normalizeRubric: fill safe defaults, accept array or object axes ──────────

test("normalizeRubric fills defaults for an empty rubric", () => {
  const r = normalizeRubric();
  assert.deepEqual(r.axes, ["resonance", "clarity", "credibility", "scrollStop"]);
  assert.deepEqual(r.killAxes, []);
  assert.equal(r.killFloor, 4.0);
  assert.equal(r.cut_threshold, 5.0);
  assert.equal(r.axisDescriptions, null);
});

test("normalizeRubric derives axes from an object-of-descriptions", () => {
  const r = normalizeRubric({ axes: { clarity: "is it clear", hook: "does it grab" } });
  assert.deepEqual(r.axes, ["clarity", "hook"]);
  assert.deepEqual(r.axisDescriptions, { clarity: "is it clear", hook: "does it grab" });
});

test("normalizeRubric preserves supplied kill config", () => {
  const r = normalizeRubric({ axes: ["a"], killAxes: ["a"], killFloor: 3, cut_threshold: 6 });
  assert.deepEqual(r.killAxes, ["a"]);
  assert.equal(r.killFloor, 3);
  assert.equal(r.cut_threshold, 6);
});

// ── renderPersona / buildEvalPrompt: default prompt construction ──────────────

test("renderPersona renders the behavioural blocks and tolerates missing ones", () => {
  const out = renderPersona({ id: "x", name: "Nit", role: "Picker", rewards: ["specificity"] });
  assert.match(out, /PERSONA: Nit — Picker/);
  assert.match(out, /Rewards:\n {4}- specificity/);
  assert.match(out, /Cares about:\n {4}- \(none stated\)/); // empty block gets a placeholder
});

test("buildEvalPrompt embeds the candidate text, persona, axes and JSON contract", () => {
  const prompt = buildEvalPrompt({
    persona: reviewPack[0],
    candidate: { text: "A grounded draft.", channel: "landing", format: "page" },
    rubric: { axes: ["resonance", "clarity"] },
  });
  assert.match(prompt, /A grounded draft\./);
  assert.match(prompt, /channel: landing; format: page/);
  assert.match(prompt, /PERSONA: Drive-by installer/);
  assert.match(prompt, /"resonance": <0-10>, "clarity": <0-10>/);
  assert.match(prompt, /ONLY a JSON object/);
});

test("buildEvalPrompt honours a custom intro override", () => {
  const prompt = buildEvalPrompt({
    persona: reviewPack[0],
    candidate: { text: "x" },
    rubric: {},
    intro: "CUSTOM INTRO LINE",
  });
  assert.match(prompt, /^CUSTOM INTRO LINE/);
});

// ── createLimiter: bound concurrency, still run everything ────────────────────

test("createLimiter never exceeds the cap and runs all tasks", async () => {
  const run = createLimiter(2);
  let active = 0;
  let peak = 0;
  const task = () =>
    new Promise((resolve) => {
      active++;
      peak = Math.max(peak, active);
      setTimeout(() => {
        active--;
        resolve("done");
      }, 5);
    });
  const results = await Promise.all(Array.from({ length: 6 }, () => run(task)));
  assert.equal(results.length, 6);
  assert.ok(results.every((r) => r === "done"));
  assert.ok(peak <= 2, `peak concurrency ${peak} exceeded cap 2`);
});

test("createLimiter propagates task rejections without wedging the queue", async () => {
  const run = createLimiter(1);
  await assert.rejects(() => run(() => Promise.reject(new Error("boom"))), /boom/);
  // Queue still pumps after a rejection.
  assert.equal(await run(() => Promise.resolve("ok")), "ok");
});

test("createLimiter falls back to a default cap for non-positive input", async () => {
  const run = createLimiter(0);
  assert.equal(await run(() => Promise.resolve(1)), 1);
});

// ── rankCandidatesWith: score, sort, split into shortlist/cut ─────────────────

test("rankCandidatesWith ranks by overall and splits keep vs cut", async () => {
  const GOOD = { resonance: 9, clarity: 9, credibility: 9, scrollStop: 9 };
  const BAD = { resonance: 2, clarity: 2, credibility: 2, scrollStop: 2 };
  const rubric = { axes: ["resonance", "clarity", "credibility", "scrollStop"], cut_threshold: 5 };
  const candidates = [
    { id: "weak", text: "weak draft" },
    { id: "strong", text: "strong draft" },
  ];
  // Panel scores are fixed per-model, independent of candidate, so drive the
  // per-candidate outcome by scoring each candidate through its own panel.
  const strongPanel = [fixedScorer("claude-a", GOOD), fixedScorer("gpt-b", GOOD)];
  const weakPanel = [fixedScorer("claude-a", BAD), fixedScorer("gpt-b", BAD)];
  const strong = await rankCandidatesWith([candidates[1]], reviewPack.slice(0, 2), rubric, {
    panel: strongPanel,
  });
  const weak = await rankCandidatesWith([candidates[0]], reviewPack.slice(0, 2), rubric, {
    panel: weakPanel,
  });
  assert.equal(strong.shortlist.length, 1);
  assert.equal(strong.cut.length, 0);
  assert.equal(strong.shortlist[0].rank, 1);
  assert.equal(weak.shortlist.length, 0);
  assert.equal(weak.cut.length, 1);
});

test("rankCandidatesWith returns empty splits for no candidates", async () => {
  const out = await rankCandidatesWith([], reviewPack.slice(0, 1), {}, { panel: [fixedScorer("m", {})] });
  assert.deepEqual(out.shortlist, []);
  assert.deepEqual(out.cut, []);
});
