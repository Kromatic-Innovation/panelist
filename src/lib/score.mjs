// score.mjs — cross-model persona scoring harness (ported from an internal persona-review engine).
//
// Given a candidate artifact, a persona list, and a RUBRIC (axes + kill axes +
// kill floor + cut threshold), it runs each persona x model pairing, parses
// robustly, aggregates, and returns a verdict. The model PANEL is INJECTED — the
// provider layer is a thin adapter, so it can sit on PromptFoo/LiteLLM later
// without any live-provider dependency bundled here. Nothing in this module
// reaches the network. Tests inject an instant mock panel; CI needs no secrets.
//
// The cross-model >=2-provider guarantee (`crossModel`) and the kill-floor
// verdict logic are preserved from the source engine.
//
// ADAPTER CONTRACT (a "panelist" / "client"):
//   { model: string, complete: async ({ prompt, maxTokens, temperature, tools }) =>
//       { ok: true, text: string, model?: string, deniedToolCalls?: array } | { ok: false, reason?: string } }
//
// Isolation (panelist#72/#77): deny by default via deps.tools/deps.toolGate
// (isolation.mjs's createToolGate), same posture as spawn.mjs/junction.mjs. The
// returned `isolation: { tools, denied }` envelope is honest — it reflects what
// was actually forwarded and denied, not just what was requested. The
// neutral/heuristic-fallback path (no model client invoked) stays `{ tools: [],
// denied: [] }` unconditionally; that is correct, not an oversight.
//
// PUBLIC API
//   score(candidate, personas, rubric, deps)  -> evaluation (alias scoreCandidate)
//   rankCandidatesWith(candidates, personas, rubric, deps) -> { shortlist, cut }
//   extractScore(text, axes)         robust JSON score parser
//   extractJsonObject(text)          generic first-balanced-object parser
//   buildEvalPrompt({...})           default prompt builder (overridable via deps)
//   fenceArtifact(text)              wrap untrusted text in an unbreakable """ fence (panelist#82)
//   normalizeRubric(rubric)          fill rubric defaults
//   createLimiter(max)               tiny promise-concurrency limiter
//
// Every evaluation this module returns (scoreCandidate/score, including the
// neutralFallback path) is auto-stamped with `honesty: USAGE_HEADER`
// (panelist#6) — the static default caveat, not the live register header. This
// module intentionally stays free of register.mjs state; a caller who wants
// the composed register header instead can re-stamp via honesty.mjs's
// stampHonesty(evaluation, getUsage()).

// ── Rubric normalization ────────────────────────────────────────────────────

import { USAGE_HEADER } from "./schema.mjs";
import { createToolGate, buildIsolationEnvelope, recordDenial } from "./isolation.mjs";
import { stampHonesty } from "./honesty.mjs";

const DEFAULT_AXES = ["resonance", "clarity", "credibility", "scrollStop"];
const DEFAULT_CUT_THRESHOLD = 5.0;
const DEFAULT_KILL_FLOOR = 4.0;
const DEFAULT_CONCURRENCY = 8;

// The neutral score stamped on every axis when the WHOLE panel fails and no
// custom fallback is supplied. Named here so its collision with
// DEFAULT_CUT_THRESHOLD (both 5) is visible at the point of definition: a
// neutral 5 on every axis aggregates to overall 5, and `decideVerdict` cuts
// only on `overall < cut_threshold`, so `5 < 5` is false. DERIVING the fallback
// verdict from these scores therefore returned "keep" on a total provider
// outage — a fail-OPEN pre-filter (panelist#80). The fallback verdict is now
// pinned to FALLBACK_VERDICT rather than derived, so a dead panel fails CLOSED.
const NEUTRAL_FALLBACK_SCORE = 5;
const FALLBACK_VERDICT = "cut";

/**
 * A tiny promise-concurrency limiter. Returns `run(fn)` that defers `fn` until
 * fewer than `max` tasks are in flight. Bounds the persona x panelist fan-out.
 */
export function createLimiter(max) {
  const cap = Number.isFinite(max) && max > 0 ? Math.floor(max) : DEFAULT_CONCURRENCY;
  let active = 0;
  const queue = [];
  const pump = () => {
    if (active >= cap || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(
        (v) => { active--; resolve(v); pump(); },
        (e) => { active--; reject(e); pump(); },
      );
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      pump();
    });
}

/** Fill a rubric with safe defaults. */
export function normalizeRubric(rubric = {}) {
  const r = rubric || {};
  const axisDescriptions =
    r.axes && typeof r.axes === "object" && !Array.isArray(r.axes) ? r.axes : null;
  const axes = Array.isArray(r.axes)
    ? r.axes
    : axisDescriptions
      ? Object.keys(axisDescriptions)
      : DEFAULT_AXES;
  const killAxes = Array.isArray(r.killAxes) ? r.killAxes : [];
  const killFloor = Number.isFinite(r.killFloor) ? r.killFloor : DEFAULT_KILL_FLOOR;
  const cut_threshold = Number.isFinite(r.cut_threshold) ? r.cut_threshold : DEFAULT_CUT_THRESHOLD;
  return { axes, killAxes, killFloor, cut_threshold, axisDescriptions };
}

// ── Default prompt construction (overridable via deps.buildPrompt) ────────────

// Zero-width space (U+200B) used to break up runs of `"` so an untrusted
// artifact can never reproduce the literal `"""` fence delimiter.
const ZERO_WIDTH_SPACE = "​";

/**
 * Fence untrusted artifact/content text with `"""` delimiters, NEUTRALIZING any
 * internal occurrence of the fence delimiter first (panelist#82). Without this,
 * an artifact whose text contains `"""` can close its own fence early and let
 * whatever follows (an injected instruction, or — worst case, on the SCORE
 * plane — forged axis JSON) flow past the intended containment and reach the
 * model as if it were part of the prompt scaffold rather than untrusted input.
 *
 * Neutralization: any run of 3-or-more double-quote characters has a
 * zero-width space inserted between each quote, so the run can no longer match
 * `"""` as a substring. This is deterministic (no random delimiter — tests must
 * be reproducible) and visually lossless: a model (and a human) still sees the
 * same quote characters, just with an invisible break inserted between them.
 * After neutralization, the ONLY two `"""` substrings in the returned string
 * are the intended opening and closing fences.
 *
 * @param {*} text  untrusted text (coerced to a string; null/undefined -> "").
 * @returns {string} `"""<neutralized text>"""`
 */
export function fenceArtifact(text) {
  const safe = String(text ?? "").replace(/"{3,}/g, (m) => m.split("").join(ZERO_WIDTH_SPACE));
  return `"""${safe}"""`;
}

/** Render a behavioural persona (caresAbout / rewards / punishes / quitsWhen). */
export function renderPersona(p) {
  const block = (label, items) => {
    const lines = (items || []).map((c) => `    - ${c}`).join("\n");
    return [`  ${label}:`, lines || "    - (none stated)"].join("\n");
  };
  return [
    `PERSONA: ${p.name || p.id} — ${p.role || ""}`,
    block("Cares about", p.caresAbout),
    block("Rewards", p.rewards),
    block("Punishes", p.punishes),
    block("Quits when", p.quitsWhen),
    p.lens ? `  Lens: ${p.lens}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function rubricText(norm) {
  const lines = ["Score the artifact FROM THIS PERSONA'S POINT OF VIEW on these axes, 0-10 (higher is better):"];
  for (const axis of norm.axes) {
    const desc = norm.axisDescriptions ? norm.axisDescriptions[axis] : "";
    lines.push(`  - ${axis}:${desc ? " " + desc : ""}`);
  }
  return lines.join("\n");
}

function jsonContract(norm) {
  const fields = norm.axes.map((a) => `"${a}": <0-10>`).join(", ");
  return [
    "Reply with ONLY a JSON object (no prose, no markdown fences):",
    `{ ${fields}, "note": "<one short line>" }`,
  ].join("\n");
}

/**
 * Default eval prompt. Override entirely via deps.buildPrompt({ persona,
 * candidate, rubric, intro }).
 */
export function buildEvalPrompt({ persona, candidate, rubric, intro }) {
  const norm = normalizeRubric(rubric);
  const cand = candidate || {};
  return [
    intro ||
      "You are a synthetic audience persona evaluating a draft. Judge ONLY as this persona would. Be a tough but fair floor: kill contextless or fabricated-smelling content, reward grounded, attention-earning substance.",
    "",
    renderPersona(persona),
    "",
    "UNDER REVIEW:",
    fenceArtifact(cand.text != null ? cand.text : ""),
    cand.channel ? `(channel: ${cand.channel}; format: ${cand.format || "?"})` : "",
    "",
    rubricText(norm),
    "",
    jsonContract(norm),
  ]
    .filter(Boolean)
    .join("\n");
}

// ── Robust JSON parsing ──────────────────────────────────────────────────────

function clampScore(v) {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  if (n < 0) return 0;
  if (n > 10) return 10;
  return n;
}

function tryJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

function sliceBalanced(s, open, close) {
  const start = s.indexOf(open);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Extract the first balanced JSON object from model text, tolerating ```json
 * fences and surrounding prose. Returns the parsed object, or null.
 */
export function extractJsonObject(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  let body = text.trim();
  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) body = fence[1].trim();
  let obj = tryJson(body);
  if (obj === undefined) {
    const sliced = sliceBalanced(body, "{", "}");
    if (sliced !== null) obj = tryJson(sliced);
  }
  if (obj === undefined || obj === null || typeof obj !== "object") return null;
  return obj;
}

/**
 * Extract a score object {<axis>..., note} from a model reply. Returns null when
 * no usable object with at least one axis is found.
 */
export function extractScore(text, axes = DEFAULT_AXES) {
  const obj = extractJsonObject(text);
  if (!obj) return null;
  const score = {};
  let any = false;
  for (const axis of axes) {
    const v = clampScore(obj[axis]);
    score[axis] = v;
    if (v !== null) any = true;
  }
  if (!any) return null;
  score.note = typeof obj.note === "string" ? obj.note.trim() : "";
  return score;
}

// ── Provider bucketing for the cross-model guarantee ─────────────────────────

export function providerOf(modelId) {
  const m = String(modelId || "").toLowerCase();
  if (m.includes("claude") || m.includes("anthropic")) return "anthropic";
  if (m.includes("gpt") || m.includes("openai") || m.includes("o1") || m.includes("o3")) return "openai";
  if (m.includes("gemini") || m.includes("google")) return "google";
  return m || "unknown";
}

function spansMultipleProviders(modelIds) {
  return new Set(modelIds.map(providerOf)).size >= 2;
}

/** Normalize a client-reported denial entry (string tool id, or {tool, at}) into the locked shape. */
function normalizeReportedDenial(entry, reviewer) {
  if (typeof entry === "string") return recordDenial(entry, reviewer);
  if (entry && typeof entry === "object" && typeof entry.tool === "string") {
    return recordDenial(entry.tool, reviewer, entry.at);
  }
  return null;
}

// ── Core scoring ─────────────────────────────────────────────────────────────

/**
 * Score a candidate across a cross-model persona panel against a rubric.
 *
 * @param {object} candidate  { text, ... }
 * @param {object[]} personas
 * @param {object} rubric
 * @param {object} deps
 *   @param {Array<{model,complete}>} deps.panel   REQUIRED injected panel/clients.
 *   @param {function} [deps.buildPrompt]          override the default prompt builder.
 *   @param {string}   [deps.intro]                domain intro line.
 *   @param {function} [deps.fallback]             whole-panel-failure fallback.
 *   @param {number}   [deps.concurrency]
 *   @param {function} [deps.limiter]
 * @returns {Promise<object>}
 */
export async function scoreCandidate(candidate, personas, rubric, deps = {}) {
  const cand = candidate || { text: "" };
  const people = Array.isArray(personas) ? personas : [];
  const panel = Array.isArray(deps.panel) ? deps.panel : [];
  if (panel.length === 0) {
    throw new Error(
      "panelist score: inject a model panel (deps.panel: [{ model, complete }]). " +
        "No live provider is bundled — pass a mock in tests, or a PromptFoo/LiteLLM adapter in production.",
    );
  }
  const norm = normalizeRubric(rubric);
  const buildPrompt = deps.buildPrompt || buildEvalPrompt;

  // Isolation (panelist#72/#77): deny by default, same posture as spawn.mjs and
  // runJunctionLoop. A caller may share one gate (deps.toolGate); otherwise
  // scoreCandidate builds its own from deps.tools, defaulting to [] when omitted.
  const gate = deps.toolGate || createToolGate({ tools: deps.tools, reviewer: "score" });
  const reportedDenied = [];

  const byPersona = [];
  const modelRows = new Map();
  let panelistsFailed = 0;

  const run = deps.limiter || createLimiter(deps.concurrency || DEFAULT_CONCURRENCY);
  const tasks = [];
  for (const persona of people) {
    const prompt = buildPrompt({ persona, candidate: cand, rubric: norm, intro: deps.intro });
    for (const panelist of panel) {
      tasks.push({ persona, panelist, prompt });
    }
  }
  const settled = await Promise.all(
    tasks.map((t) =>
      run(async () => {
        try {
          return await t.panelist.complete({ prompt: t.prompt, maxTokens: 512, temperature: 0, tools: gate.tools });
        } catch {
          return { ok: false, reason: "threw" };
        }
      }),
    ),
  );

  for (let i = 0; i < tasks.length; i++) {
    const { persona, panelist } = tasks[i];
    const modelId = panelist.model || "unknown";
    const res = settled[i];
    if (!res || res.ok !== true || typeof res.text !== "string") {
      panelistsFailed++;
      continue;
    }
    // Merge the gate's own denials (recorded by gate.check() calls, if the
    // adapter used it) with any the adapter self-reports via res.deniedToolCalls
    // — an adapter that enforces upstream of panelist still gets denials surfaced.
    const reported = Array.isArray(res.deniedToolCalls) ? res.deniedToolCalls : [];
    for (const entry of reported) {
      const denial = normalizeReportedDenial(entry, persona.id || persona.name || "persona");
      if (denial) reportedDenied.push(denial);
    }
    const score = extractScore(res.text, norm.axes);
    if (!score) {
      panelistsFailed++;
      continue;
    }
    const overall = axisMean(score, norm.axes);
    const row = {
      persona: persona.id || persona.name || "persona",
      personaName: persona.name || persona.id || "persona",
      model: res.model || modelId,
      note: score.note || "",
    };
    for (const axis of norm.axes) row[axis] = score[axis];
    byPersona.push(row);
    const key = res.model || modelId;
    if (!modelRows.has(key)) modelRows.set(key, []);
    modelRows.get(key).push(overall);
  }

  if (byPersona.length === 0) {
    const fb = deps.fallback || neutralFallback;
    // A custom deps.fallback replaces neutralFallback wholesale, including its
    // honesty stamp — post-process through stampHonesty here so the caller's
    // callback can't accidentally drop the caveat (panelist#81, PAN-03).
    // stampHonesty is idempotent, so the built-in neutralFallback path (already
    // stamped) is unaffected. Same usage resolution neutralFallback uses.
    return stampHonesty(fb(cand, panelistsFailed, norm), USAGE_HEADER);
  }

  const aggregate = aggregateAxes(byPersona, norm.axes);
  const byModel = {};
  for (const [model, overalls] of modelRows) byModel[model] = round2(mean(overalls));

  return {
    candidate: cand,
    scores: { byPersona, byModel },
    aggregate,
    verdict: decideVerdict(aggregate, norm),
    crossModel: spansMultipleProviders(Object.keys(byModel)),
    panelistsFailed,
    honesty: USAGE_HEADER,
    // Isolation (panelist#72/#77): deny by default. deps.tools lets a caller
    // declare an explicit grant if their panel wraps an agentic/tool-capable
    // adapter; the gate enforces it (forwarded to every complete() call above)
    // and denied carries both the gate's own denials and any the adapter
    // self-reports via res.deniedToolCalls. A wildcard grant throws — see
    // isolation.mjs's createToolGate/resolveEffectiveTools.
    isolation: buildIsolationEnvelope(gate.tools, [...gate.denied, ...reportedDenied]),
  };
}

/** Public alias — the exported name per the panelist contract. */
export const score = scoreCandidate;

function axisMean(scoreObj, axes) {
  const vals = axes.map((a) => scoreObj[a]).filter((v) => v !== null && v !== undefined);
  return vals.length ? mean(vals) : 0;
}

function aggregateAxes(byPersona, axes) {
  const agg = {};
  for (const axis of axes) {
    const vals = byPersona.map((r) => r[axis]).filter((v) => v !== null && v !== undefined);
    agg[axis] = vals.length ? round2(mean(vals)) : 0;
  }
  agg.overall = round2(mean(axes.map((a) => agg[a])));
  return agg;
}

/** Verdict: cut when overall < cut_threshold OR any kill axis < killFloor. */
export function decideVerdict(aggregate, rubric) {
  const norm = normalizeRubric(rubric);
  if (aggregate.overall < norm.cut_threshold) return "cut";
  for (const axis of norm.killAxes) {
    if (typeof aggregate[axis] === "number" && aggregate[axis] < norm.killFloor) return "cut";
  }
  return "keep";
}

/** Whole-panel-failure fallback: neutral scores, marked, but fails CLOSED. */
function neutralFallback(candidate, panelistsFailed, rubric) {
  const norm = normalizeRubric(rubric);
  const s = NEUTRAL_FALLBACK_SCORE;
  const row = {
    persona: "fallback",
    model: "heuristic:fallback",
    note: "panel unavailable — neutral fallback; REQUIRES HUMAN REVIEW, never auto-publish",
  };
  const aggregate = {};
  for (const axis of norm.axes) {
    row[axis] = s;
    aggregate[axis] = s;
  }
  aggregate.overall = round2(mean(norm.axes.map((a) => aggregate[a])));
  return {
    candidate,
    scores: { byPersona: [row], byModel: { "heuristic:fallback": aggregate.overall } },
    aggregate,
    // Pinned to FALLBACK_VERDICT, NOT derived from the neutral scores: a total
    // panel failure must never surface a passing verdict to a programmatic gate
    // (panelist#80). The neutral 5s are still reported for human context; the
    // machine-readable verdict fails closed.
    verdict: FALLBACK_VERDICT,
    crossModel: false,
    panelistsFailed,
    fallback: true,
    honesty: USAGE_HEADER,
    isolation: buildIsolationEnvelope([], []),
  };
}

// ── Ranking ──────────────────────────────────────────────────────────────────

/**
 * Score every candidate, sort by overall desc (tie-break by first two kill axes,
 * else declared axis order), assign ranks, partition keep/cut.
 */
export async function rankCandidatesWith(candidates, personas, rubric, deps = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  const norm = normalizeRubric(rubric);
  const tieAxes = (norm.killAxes.length ? norm.killAxes : norm.axes).slice(0, 2);
  const limiter = deps.limiter || createLimiter(deps.concurrency || DEFAULT_CONCURRENCY);
  const scored = await Promise.all(
    list.map((candidate) => scoreCandidate(candidate, personas, norm, { ...deps, limiter })),
  );
  const evaluated = scored.map((evaluation, i) => ({ ...list[i], evaluation }));

  evaluated.sort((a, b) => {
    const ao = a.evaluation.aggregate;
    const bo = b.evaluation.aggregate;
    let d = bo.overall - ao.overall;
    for (const axis of tieAxes) {
      if (d !== 0) break;
      d = (bo[axis] || 0) - (ao[axis] || 0);
    }
    return d;
  });
  evaluated.forEach((e, i) => {
    e.rank = i + 1;
  });

  // The inner per-candidate `.evaluation` objects are already stamped (score()
  // above), but the returned { shortlist, cut } wrapper is itself a public
  // output surface — the cut-list product — so it gets its own stamp too
  // (panelist#81).
  return stampHonesty(
    {
      shortlist: evaluated.filter((e) => e.evaluation.verdict === "keep"),
      cut: evaluated.filter((e) => e.evaluation.verdict === "cut"),
    },
    USAGE_HEADER,
  );
}

// ── Numeric helpers ──────────────────────────────────────────────────────────

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
