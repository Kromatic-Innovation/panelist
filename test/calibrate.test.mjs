import { test } from "node:test";
import assert from "node:assert/strict";
import {
  spearmanRankCorrelation,
  keptSetHitRate,
  calibratePersonas,
} from "../src/lib/calibrate.mjs";

// ── spearmanRankCorrelation ──────────────────────────────────────────────────

test("spearmanRankCorrelation: perfectly monotonic increasing -> 1", () => {
  assert.equal(spearmanRankCorrelation([1, 2, 3, 4, 5], [10, 20, 30, 40, 50]), 1);
});

test("spearmanRankCorrelation: perfectly inverse -> -1", () => {
  assert.equal(spearmanRankCorrelation([1, 2, 3, 4, 5], [5, 4, 3, 2, 1]), -1);
});

test("spearmanRankCorrelation: known mixed case -> correct rho", () => {
  // a=[1,2,3,4,5] vs b=[5,3,4,1,2]. Ranks of b: [5,3,4,1,2] (no ties).
  // d = a-b ranks = [-4, -1, -1, 3, 3]; hand-computed Pearson-on-ranks rho = -0.8.
  assert.equal(spearmanRankCorrelation([1, 2, 3, 4, 5], [5, 3, 4, 1, 2]), -0.8);
});

test("spearmanRankCorrelation: unequal lengths -> null", () => {
  assert.equal(spearmanRankCorrelation([1, 2, 3], [1, 2]), null);
});

test("spearmanRankCorrelation: empty arrays -> null", () => {
  assert.equal(spearmanRankCorrelation([], []), null);
});

test("spearmanRankCorrelation: constant array -> null", () => {
  assert.equal(spearmanRankCorrelation([5, 5, 5, 5], [1, 2, 3, 4]), null);
  assert.equal(spearmanRankCorrelation([1, 2, 3, 4], [5, 5, 5, 5]), null);
});

test("spearmanRankCorrelation: handles ties via average rank", () => {
  // a=[1,2,2,3,4] (tie at 2,2) vs b=[10,20,20,15,5] (tie at 20,20).
  // Hand-computed (average-rank Pearson-on-ranks): rho = -0.368421... -> -0.37.
  assert.equal(spearmanRankCorrelation([1, 2, 2, 3, 4], [10, 20, 20, 15, 5]), -0.37);
});

// ── keptSetHitRate ───────────────────────────────────────────────────────────

test("keptSetHitRate: all kept were good -> 1", () => {
  assert.equal(keptSetHitRate([true, true, false], [true, true, false]), 1);
});

test("keptSetHitRate: none good -> 0", () => {
  assert.equal(keptSetHitRate([true, true, false], [false, false, true]), 0);
});

test("keptSetHitRate: mixed case -> correct fraction", () => {
  // kept = indices 0,1,3; good = indices 0,2,3 -> hits at 0 and 3 -> 2/3.
  const kept = [true, true, false, true];
  const good = [true, false, true, true];
  assert.equal(keptSetHitRate(kept, good), round2(2 / 3));
});

test("keptSetHitRate: empty kept set -> null", () => {
  assert.equal(keptSetHitRate([false, false, false], [true, true, true]), null);
});

test("keptSetHitRate: unequal lengths -> null", () => {
  assert.equal(keptSetHitRate([true, false], [true]), null);
});

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ── calibratePersonas ────────────────────────────────────────────────────────

test("calibratePersonas: predictive persona ranks above noisy/inverse persona", () => {
  const items = ["p1", "p2", "p3", "p4", "p5"];
  const realSignal = [10, 20, 30, 40, 50]; // monotonic increasing real engagement
  const syntheticByPersona = {
    goodPredictor: [1, 2, 3, 4, 5], // tracks realSignal ranks
    inverse: [5, 4, 3, 2, 1], // anti-correlated
    noise: [3, 1, 4, 1, 5], // scrambled
  };
  const result = calibratePersonas({ items, syntheticByPersona, realSignal });

  assert.equal(result.n, 5);
  assert.match(result.note, /not.*validation/i);
  assert.equal(result.leaderboard[0].personaId, "goodPredictor");
  assert.equal(result.leaderboard[0].spearman, 1);
  // inverse should rank last among the non-constant personas (worst spearman).
  const inverseIdx = result.leaderboard.findIndex((r) => r.personaId === "inverse");
  const noiseIdx = result.leaderboard.findIndex((r) => r.personaId === "noise");
  assert.ok(inverseIdx > 0);
  assert.ok(noiseIdx > 0);
  assert.equal(result.leaderboard[result.leaderboard.length - 1].personaId, "inverse");
});

test("calibratePersonas: leaderboard sorted predict-well-first", () => {
  const items = ["a", "b", "c", "d"];
  const realSignal = [1, 2, 3, 4];
  const syntheticByPersona = {
    strong: [1, 2, 3, 4],
    weak: [2, 1, 4, 3],
  };
  const result = calibratePersonas({ items, syntheticByPersona, realSignal });
  assert.deepEqual(
    result.leaderboard.map((r) => r.personaId),
    ["strong", "weak"],
  );
  assert.ok(result.leaderboard[0].spearman >= result.leaderboard[1].spearman);
});

test("calibratePersonas: constant-score persona present with null spearman, sorts last", () => {
  const items = ["a", "b", "c", "d"];
  const realSignal = [1, 2, 3, 4];
  const syntheticByPersona = {
    predictive: [1, 2, 3, 4],
    constant: [7, 7, 7, 7],
  };
  const result = calibratePersonas({ items, syntheticByPersona, realSignal });
  assert.equal(result.leaderboard.length, 2);
  const constantRow = result.leaderboard.find((r) => r.personaId === "constant");
  assert.ok(constantRow, "constant persona must still be reported");
  assert.equal(constantRow.spearman, null);
  assert.equal(result.leaderboard[result.leaderboard.length - 1].personaId, "constant");
});

test("calibratePersonas: n and note are always set", () => {
  const items = ["a", "b", "c"];
  const realSignal = [1, 2, 3];
  const syntheticByPersona = { solo: [3, 2, 1] };
  const result = calibratePersonas({ items, syntheticByPersona, realSignal });
  assert.equal(result.n, 3);
  assert.equal(typeof result.note, "string");
  assert.ok(result.note.length > 0);
  assert.equal(result.leaderboard[0].n, 3);
});

test("calibratePersonas: respects explicit keep/good thresholds", () => {
  const items = ["a", "b", "c", "d"];
  const realSignal = [1, 2, 3, 100]; // median would be 2.5; force goodThreshold to 100
  const syntheticByPersona = { p: [1, 1, 1, 10] }; // median would be 1; force keepThreshold to 10
  const result = calibratePersonas({
    items,
    syntheticByPersona,
    realSignal,
    keepThreshold: 10,
    goodThreshold: 100,
  });
  // Only item d (index 3) is kept (score 10 >= 10) and only item d is good (100 >= 100).
  assert.equal(result.leaderboard[0].keptSetHitRate, 1);
});

test("calibratePersonas: default thresholds are the median of each array", () => {
  const items = ["a", "b", "c", "d", "e"];
  const realSignal = [1, 2, 3, 4, 5]; // median 3 -> good = items with value >=3 -> c,d,e
  const syntheticByPersona = { p: [5, 4, 3, 2, 1] }; // median 3 -> kept = items with value>=3 -> a,b,c
  const result = calibratePersonas({ items, syntheticByPersona, realSignal });
  // kept = {a,b,c} (indices 0,1,2), good = {c,d,e} (indices 2,3,4) -> intersection {c} -> 1/3.
  assert.equal(result.leaderboard[0].keptSetHitRate, round2(1 / 3));
});
