// calibrate.mjs — calibration harness: synthetic persona verdicts vs INJECTED
// real downstream signal (panelist#5, "Persona v2 — H").
//
// This joins each persona's SYNTHETIC per-item scores to a caller-supplied real
// downstream signal (GA4 events, BigQuery conversion/bounce/forward data,
// opens/scroll-depth/whatever the artifact's real-world outcome is) and reports
// how well the synthetic ranking predicted the real one. NO live analytics
// provider (GA4/BigQuery client or otherwise) is bundled or imported here — the
// caller supplies `realSignal` as plain numbers, exactly the way score.mjs
// never bundles a model provider and instead takes an injected `deps.panel`.
// Nothing in this module reaches the network or the filesystem.
//
// D6 — which posts (the corpus), which real signal (opens / scroll-depth /
// forwards / conversions), and which of the two statistics below to privilege
// for a given dataset — is a RUNTIME choice the caller makes. It is
// deliberately NOT hardcoded here: this harness is generic over any equal-
// length (items, syntheticByPersona, realSignal) triple the caller assembles.
//
// Per doc §5: calibration is deferred, not skipped, and a weak or `null`
// correlation is reported honestly as calibration debt, not hidden or dropped
// from the leaderboard.
//
// PUBLIC API
//   spearmanRankCorrelation(a, b)   Spearman's rho, ties via average rank
//   keptSetHitRate(kept, good)     |kept ∩ good| / |kept|
//   calibratePersonas({ items, syntheticByPersona, realSignal, keepThreshold?, goodThreshold? })
//
// Honesty stamp (panelist#81): calibratePersonas's `note` field already carries
// honesty LANGUAGE ("it is NOT validation...") but that text alone does not
// satisfy the assertHonestyStamped guardrail — the note's "NOT" is uppercase,
// while HONESTY_MARKER ("not validation") is a case-sensitive substring check,
// and assertHonestyStamped only ever looks at an object's `honesty` field, not
// `note`. Rather than reshaping `note` to match, the result is additionally
// stamped via honesty.mjs's stampHonesty, which adds a proper `honesty` field
// alongside the existing `note` (additive, non-breaking).

import { stampHonesty } from "./honesty.mjs";

// ── Numeric helpers (module-private; score.mjs does not export mean/round2) ─

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Average-rank ranking (1-based): ties get the mean of the ranks they span. */
function rank(arr) {
  const idx = arr.map((v, i) => i).sort((a, b) => arr[a] - arr[b]);
  const ranks = new Array(arr.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && arr[idx[j + 1]] === arr[idx[i]]) j++;
    const avgRank = (i + j) / 2 + 1; // 1-based average of ranks i+1..j+1
    for (let k = i; k <= j; k++) ranks[idx[k]] = avgRank;
    i = j + 1;
  }
  return ranks;
}

// ── Statistics ───────────────────────────────────────────────────────────────

/**
 * Spearman's rank correlation coefficient between two equal-length numeric
 * arrays: rank both, then Pearson correlation on the ranks (average ranks for
 * ties). Returns a number in [-1, 1] rounded to 2dp, or `null` when undefined
 * (unequal/empty lengths, or either array has zero variance).
 */
export function spearmanRankCorrelation(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return null;
  const n = a.length;
  if (n === 0 || n !== b.length) return null;

  const ra = rank(a);
  const rb = rank(b);
  const ma = mean(ra);
  const mb = mean(rb);

  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    const da = ra[i] - ma;
    const db = rb[i] - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  if (va === 0 || vb === 0) return null; // constant array -> undefined correlation

  const rho = cov / Math.sqrt(va * vb);
  return round2(rho);
}

/**
 * Kept-set hit rate: of the items the persona would KEEP, what fraction
 * actually performed well downstream? |kept ∩ good| / |kept|.
 * `keptFlags`/`realGoodFlags` are equal-length boolean (or truthy) arrays.
 * Returns null when the kept set is empty (undefined, not zero).
 */
export function keptSetHitRate(keptFlags, realGoodFlags) {
  if (!Array.isArray(keptFlags) || !Array.isArray(realGoodFlags)) return null;
  const n = keptFlags.length;
  if (n === 0 || n !== realGoodFlags.length) return null;

  let kept = 0;
  let hits = 0;
  for (let i = 0; i < n; i++) {
    if (keptFlags[i]) {
      kept++;
      if (realGoodFlags[i]) hits++;
    }
  }
  if (kept === 0) return null;
  return round2(hits / kept);
}

// ── Top-level harness ────────────────────────────────────────────────────────

/**
 * Join each persona's synthetic per-item scores to the injected real downstream
 * signal, and rank personas by predictive usefulness (not by how well they read).
 *
 * @param {object} args
 * @param {Array} args.items                    item ids (published posts), length N.
 * @param {Object<string, number[]>} args.syntheticByPersona
 *   per-persona synthetic score per item, aligned to `items`; higher = liked/kept more.
 * @param {number[]} args.realSignal             injected real downstream engagement per
 *   item, aligned to `items`. What it measures (opens/scroll/forwards/conversions) is
 *   D6 — the caller's runtime choice, not this module's.
 * @param {number} [args.keepThreshold]          per-persona: default is that persona's
 *   own median synthetic score; at/above = persona "keeps" the item.
 * @param {number} [args.goodThreshold]          default is the median of realSignal;
 *   at/above = the item actually performed well.
 * @returns {{ leaderboard: object[], n: number, note: string }}
 */
export function calibratePersonas({
  items,
  syntheticByPersona,
  realSignal,
  keepThreshold,
  goodThreshold,
} = {}) {
  const ids = Array.isArray(items) ? items : [];
  const n = ids.length;
  const real = Array.isArray(realSignal) ? realSignal : [];
  const byPersona = syntheticByPersona && typeof syntheticByPersona === "object" ? syntheticByPersona : {};

  const good = Number.isFinite(goodThreshold) ? goodThreshold : median(real.length ? real : [0]);
  const realGoodFlags = real.map((v) => v >= good);

  const leaderboard = Object.keys(byPersona).map((personaId) => {
    const scores = Array.isArray(byPersona[personaId]) ? byPersona[personaId] : [];
    const itemCount = Math.min(n, scores.length, real.length);

    const keep = Number.isFinite(keepThreshold) ? keepThreshold : median(scores.length ? scores : [0]);
    const keptFlags = scores.map((v) => v >= keep);

    const spearman = spearmanRankCorrelation(scores, real);
    const hitRate = keptSetHitRate(keptFlags, realGoodFlags);

    return { personaId, spearman, keptSetHitRate: hitRate, n: itemCount };
  });

  // Personas that predict well sort first: rank by spearman desc (null last),
  // tie-broken by keptSetHitRate desc (null last).
  leaderboard.sort((a, b) => {
    if (a.spearman === null && b.spearman === null) return 0;
    if (a.spearman === null) return 1;
    if (b.spearman === null) return -1;
    if (b.spearman !== a.spearman) return b.spearman - a.spearman;
    const ah = a.keptSetHitRate === null ? -Infinity : a.keptSetHitRate;
    const bh = b.keptSetHitRate === null ? -Infinity : b.keptSetHitRate;
    return bh - ah;
  });

  // ADDITIVE: stamp a proper `honesty` field alongside the existing `note`
  // (panelist#81) — see the module header for why `note`'s existing language
  // doesn't already satisfy assertHonestyStamped.
  return stampHonesty({
    leaderboard,
    n,
    note:
      "This reports predictive usefulness of a cheap synthetic pre-filter against " +
      "the injected real signal — it is NOT validation and does not make the panel " +
      "equivalent to real user research (see docs/synthetic-persona-best-practices.md §5-6). " +
      "A weak or null correlation is calibration debt to track, not a bug to hide.",
  });
}
