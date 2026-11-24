import { test } from "node:test";
import assert from "node:assert/strict";
import { score, normalizeRubric } from "../src/lib/score.mjs";
import { fixedScorer, deadClient, mockClient } from "./_helpers.mjs";

// panelist#245: per-persona coverage (personasMissing / requireEveryPersona / verdictReason).

const RUBRIC = { axes: ["resonance", "clarity"], killAxes: [], killFloor: 4, cut_threshold: 5 };
const GOOD = { resonance: 8, clarity: 8 };
const cand = { text: "An artifact under review." };
const PERSONAS = [{ id: "optimist" }, { id: "skeptic" }, { id: "pragmatist" }];
// The prompt is just the persona id, so a panelist can fail for one persona only.
const buildPrompt = ({ persona }) => persona.id;

/** Scores GOOD for every persona except `failFor`, whose calls fail at transport level. */
function failingFor(model, failFor) {
  return {
    model,
    async complete({ prompt }) {
      if (prompt === failFor) return { ok: false, reason: "simulated failure" };
      return { ok: true, text: JSON.stringify({ ...GOOD, note: "mock" }), model };
    },
  };
}
const threeModels = (failFor) => ["claude-a", "gpt-b", "gemini-c"].map((m) => failingFor(m, failFor));

test("3x3 with one persona fully failed: verdict derived, personasMissing names it (setting off)", async () => {
  const res = await score(cand, PERSONAS, RUBRIC, { retries: 0, panel: threeModels("skeptic"), buildPrompt });
  assert.equal(res.panelistsReported, 6);
  assert.equal(res.panelSize, 9);
  assert.equal(res.quorum.met, true);
  assert.equal(res.verdict, "keep");
  assert.deepEqual(res.personasMissing, ["skeptic"]);
  assert.equal(res.verdictReason, "score");
});

test("3x3 with one persona fully failed and requireEveryPersona: cut / persona-missing", async () => {
  const res = await score(cand, PERSONAS, { ...RUBRIC, requireEveryPersona: true }, { retries: 0, panel: threeModels("skeptic"), buildPrompt });
  assert.equal(res.verdict, "cut");
  assert.equal(res.verdictReason, "persona-missing");
  assert.deepEqual(res.personasMissing, ["skeptic"]);
});

test("all personas present: empty personasMissing, no forced cut even with the setting on", async () => {
  const res = await score(cand, PERSONAS, { ...RUBRIC, requireEveryPersona: true }, { retries: 0, panel: threeModels(null), buildPrompt });
  assert.deepEqual(res.personasMissing, []);
  assert.equal(res.verdict, "keep");
  assert.equal(res.verdictReason, "score");
});

test("a persona with only SOME calls failing is not missing", async () => {
  const panel = [failingFor("claude-a", "skeptic"), fixedScorer("gpt-b", GOOD), fixedScorer("gemini-c", GOOD)];
  const res = await score(cand, PERSONAS, { ...RUBRIC, requireEveryPersona: true }, { retries: 0, panel, buildPrompt });
  assert.deepEqual(res.personasMissing, []);
  assert.equal(res.verdictReason, "score");
});

test("below-quorum: verdictReason below-quorum outranks persona-missing", async () => {
  const res = await score(cand, [{ id: "optimist" }, { id: "skeptic" }], { ...RUBRIC, requireEveryPersona: true }, {
    retries: 0,
    panel: [mockClient("claude-a", () => JSON.stringify(GOOD)), deadClient("dead-b"), deadClient("dead-c")],
    buildPrompt,
  });
  assert.equal(res.quorum.met, false);
  assert.equal(res.verdict, "cut");
  assert.equal(res.verdictReason, "below-quorum");
});

test("total outage (built-in fallback): every persona missing, verdictReason total-outage", async () => {
  const res = await score(cand, PERSONAS, RUBRIC, { retries: 0, panel: [deadClient("a"), deadClient("b")], buildPrompt });
  assert.equal(res.fallback, true);
  assert.deepEqual(res.personasMissing, ["optimist", "skeptic", "pragmatist"]);
  assert.equal(res.verdictReason, "total-outage");
});

test("total outage (custom deps.fallback): fields are stamped by the library", async () => {
  const fallback = () => ({ verdict: "keep", personasMissing: [], verdictReason: "score" });
  const res = await score(cand, PERSONAS, RUBRIC, { retries: 0, panel: [deadClient("a")], buildPrompt, fallback });
  assert.equal(res.verdict, "cut");
  assert.deepEqual(res.personasMissing, ["optimist", "skeptic", "pragmatist"]);
  assert.equal(res.verdictReason, "total-outage");
});

test("normalizeRubric: requireEveryPersona defaults false, non-boolean -> false, never throws", () => {
  assert.equal(normalizeRubric({}).requireEveryPersona, false);
  assert.equal(normalizeRubric({ requireEveryPersona: true }).requireEveryPersona, true);
  for (const bad of ["true", 1, null, {}, []]) {
    assert.equal(normalizeRubric({ requireEveryPersona: bad }).requireEveryPersona, false);
  }
  const once = normalizeRubric({ requireEveryPersona: true });
  assert.equal(normalizeRubric(once).requireEveryPersona, true);
});
