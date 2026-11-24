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

// Honest-by-construction: only a real finite number counts. Numeric strings ("3") do NOT.
function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

// A "keyed" side is an array of `{ id, value }` entries or a plain `{ [id]: value }` object.
// Returns Map<id, value>, or null when the side is positional (a plain array of values).
function toKeyedMap(side) {
  if (Array.isArray(side)) {
    if (side.length > 0 && side.every((e) => e !== null && typeof e === "object" && "id" in e)) {
      return new Map(side.map((e) => [e.id, e.value]));
    }
    return null;
  }
  if (side !== null && typeof side === "object") return new Map(Object.entries(side));
  return null;
}

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
 * ties). Pairs where either side is not a finite number (`typeof` number and
 * finite — null, undefined, NaN, Infinity and numeric strings like "3" are all
 * skipped) are dropped before ranking. Returns a number in [-1, 1] rounded to
 * 2dp, or `null` when undefined (unequal/empty lengths, no usable pairs, or
 * either array has zero variance).
 */
export function spearmanRankCorrelation(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return null;
  if (a.length === 0 || a.length !== b.length) return null;

  // Pairwise-skip (panelist#238): a pair where either side is not a finite number
  // (null, undefined, NaN, Infinity, numeric strings like "3") is dropped, never ranked.
  const xs = [];
  const ys = [];
  for (let i = 0; i < a.length; i++) {
    if (isFiniteNumber(a[i]) && isFiniteNumber(b[i])) {
      xs.push(a[i]);
      ys.push(b[i]);
    }
  }
  a = xs;
  b = ys;
  const n = a.length;
  if (n === 0) return null;

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
 * @param {Array} args.items                    item ids (published posts).
 * @param {Object<string, number[]|object[]|object>} args.syntheticByPersona
 *   per-persona synthetic score per item; higher = liked/kept more. Either positional
 *   (an array aligned to `items`) or keyed by id (an array of `{ id, value }` entries, or
 *   an `{ [id]: value }` object).
 * @param {number[]|object[]|object} args.realSignal  injected real downstream engagement per
 *   item, positional or keyed exactly like the synthetic scores. What it measures
 *   (opens/scroll/forwards/conversions) is D6 — the caller's runtime choice, not this module's.
 *
 * Matching (panelist#238): when EITHER side is keyed by id, the two are joined by id over
 * `items` (or, when `items` is empty, over the keyed real signal's ids); a positional side is
 * read as `items[i] -> value`, so a keyed side needs `items` to join a positional one. An id
 * missing on either side drops that pair. With no ids at all, sides are matched by position.
 * In every mode a pair where either value is not a finite number (null, undefined, NaN,
 * Infinity, and numeric strings such as "3" — `typeof` must be "number") is SKIPPED, not
 * rejected. Each leaderboard row's `n` is the number of pairs actually used; when no
 * correlation can be computed (positional length mismatch, or ids that cannot be joined)
 * it is 0 and `spearman`/`keptSetHitRate` are null. The top-level `n` is the largest
 * per-persona `n`.
 * @param {number} [args.keepThreshold]          per-persona: default is the median of that
 *   persona's usable synthetic scores; at/above = persona "keeps" the item.
 * @param {number} [args.goodThreshold]          default is the median of the usable real
 *   values; at/above = the item actually performed well.
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
  const byPersona = syntheticByPersona && typeof syntheticByPersona === "object" ? syntheticByPersona : {};
  const realMap = toKeyedMap(realSignal);

  const leaderboard = Object.keys(byPersona).map((personaId) => {
    const side = byPersona[personaId];
    const scoreMap = toKeyedMap(side);
    let xs = []; // synthetic, usable pairs
    let ys = []; // real, usable pairs
    let joinable = true;

    if (realMap || scoreMap) {
      // Id join.
      const lookup = (map, positional) => {
        if (map) return (id) => map.get(id);
        const m = new Map();
        if (Array.isArray(positional)) ids.forEach((id, i) => m.set(id, positional[i]));
        return (id) => m.get(id);
      };
      const universe = ids.length ? ids : [...(realMap ?? scoreMap).keys()];
      if ((!realMap || !scoreMap) && !ids.length) joinable = false; // positional side has no ids to join on
      const getS = lookup(scoreMap, side);
      const getR = lookup(realMap, realSignal);
      if (joinable) {
        for (const id of universe) {
          const x = getS(id);
          const y = getR(id);
          if (isFiniteNumber(x) && isFiniteNumber(y)) {
            xs.push(x);
            ys.push(y);
          }
        }
      }
    } else {
      // Positional join: lengths must agree, otherwise nothing is computed.
      const sc = Array.isArray(side) ? side : [];
      const rl = Array.isArray(realSignal) ? realSignal : [];
      if (sc.length === rl.length) {
        for (let i = 0; i < sc.length; i++) {
          if (isFiniteNumber(sc[i]) && isFiniteNumber(rl[i])) {
            xs.push(sc[i]);
            ys.push(rl[i]);
          }
        }
      }
    }

    if (!joinable || xs.length === 0) {
      return { personaId, spearman: null, keptSetHitRate: null, n: 0 };
    }

    const good = Number.isFinite(goodThreshold) ? goodThreshold : median(ys);
    const keep = Number.isFinite(keepThreshold) ? keepThreshold : median(xs);
    const keptFlags = xs.map((v) => v >= keep);
    const realGoodFlags = ys.map((v) => v >= good);

    const spearman = spearmanRankCorrelation(xs, ys);
    const hitRate = keptSetHitRate(keptFlags, realGoodFlags);

    return { personaId, spearman, keptSetHitRate: hitRate, n: xs.length };
  });
  const n = leaderboard.reduce((m, r) => Math.max(m, r.n), 0);

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
