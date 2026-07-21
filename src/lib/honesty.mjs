// honesty.mjs — honesty guardrails on panel output (panelist#6).
//
// D7 (resolved): after persona-as-subagent and the generic runner
// (panelist#4 / D5), there is NO second static source of truth to drift
// against — the runner renders identity LIVE from the register at call time
// (see runner.mjs), so drift-check does NOT need to retarget to
// "register-vs-rendered-prompt" (that check would just re-verify the
// identity function call, not catch anything real). Instead, drift-check
// KEEPS its record-schema validation role (schema.mjs) and GAINS honesty-
// stamp coverage: this module's assertHonestyStamped is what drift-check
// (drift-check.mjs's checkHonesty) calls to prove no summary omits the
// caveat.
//
// Practical rules this module exists to enforce (docs/synthetic-persona-
// best-practices.md §6):
//   - Auto-stamp the caveat on every panel output, by construction.
//   - Deal-killers / cut-list over a warmth score, in the default summary.
//
// Pure, zero-dep ESM.

import { USAGE_HEADER } from "./schema.mjs";
import { getUsage } from "./register.mjs";

// A short, stable substring of USAGE_HEADER. Chosen because it's the single
// clause that most directly names what panelist is NOT — the phrase a summary
// would have to actively strip to launder a cut-list into "validation".
// Any composed register usage string that preserves this clause (the common
// case: callers layer more words on, they don't excise the core sentence)
// still satisfies the guardrail.
export const HONESTY_MARKER = "not validation";

// Fail loudly (dev-time only) if the marker and the canonical header ever
// drift apart — this is a build-time sanity check, not a runtime assertion.
if (!USAGE_HEADER.includes(HONESTY_MARKER)) {
  throw new Error("honesty.mjs: HONESTY_MARKER is no longer a substring of schema.mjs's USAGE_HEADER");
}

/**
 * Return a shallow copy of `envelope` with a single `honesty` field set to
 * `usage` (default: the live register header, falling back to the static
 * default). Idempotent: re-stamping replaces rather than duplicates the
 * field. Never mutates the input.
 * @param {object} envelope
 * @param {string} [usage]
 * @returns {object}
 */
export function stampHonesty(envelope, usage) {
  const base = envelope && typeof envelope === "object" ? envelope : {};
  const honesty = typeof usage === "string" && usage ? usage : getUsage() || USAGE_HEADER;
  return { ...base, honesty };
}

function lowestAxis(aggregate) {
  if (!aggregate || typeof aggregate !== "object") return null;
  let worst = null;
  for (const [axis, v] of Object.entries(aggregate)) {
    if (axis === "overall" || typeof v !== "number") continue;
    if (worst === null || v < worst.value) worst = { axis, value: v };
  }
  return worst;
}

/**
 * Render a short human-readable panel summary. Leads with the verdict /
 * deal-killer framing (never a warmth-score headline) and ALWAYS ends with
 * the honesty caveat. Always contains HONESTY_MARKER.
 * @param {object} evaluation  a score.mjs evaluation ({ verdict, aggregate,
 *   ... }) or a spawn.mjs wrapper ({ verdict, dealKillers, message, ... }).
 * @param {object} [opts]
 *   @param {string} [opts.label]  optional candidate label for the headline.
 * @returns {string}
 */
export function formatPanelSummary(evaluation, opts = {}) {
  const ev = evaluation && typeof evaluation === "object" ? evaluation : {};
  const label = typeof opts.label === "string" && opts.label ? `${opts.label}: ` : "";
  const verdict = typeof ev.verdict === "string" ? ev.verdict : "unknown";

  const lines = [];
  const dealKillers = Array.isArray(ev.dealKillers) ? ev.dealKillers.filter((x) => typeof x === "string" && x) : [];

  if (verdict === "cut") {
    lines.push(`${label}CUT.`);
  } else if (verdict === "keep") {
    lines.push(`${label}KEEP.`);
  } else {
    lines.push(`${label}VERDICT: ${verdict}.`);
  }

  if (dealKillers.length) {
    lines.push(`Deal-killers: ${dealKillers.join("; ")}`);
  } else {
    const worst = lowestAxis(ev.aggregate);
    if (worst) {
      lines.push(`Weakest axis: ${worst.axis} (${worst.value}).`);
    } else if (verdict === "unknown") {
      lines.push("No deal-killers or aggregate available.");
    } else {
      lines.push("No deal-killers surfaced.");
    }
  }

  const honesty = typeof ev.honesty === "string" && ev.honesty ? ev.honesty : getUsage() || USAGE_HEADER;
  lines.push(honesty);

  return lines.join(" ");
}

/**
 * The CI/drift guardrail: assert the honesty caveat is present. Accepts a
 * summary string OR a panel-output envelope object. NEVER throws.
 * @param {string|object} x
 * @returns {{ ok: boolean, reason?: string }}
 */
export function assertHonestyStamped(x) {
  if (typeof x === "string") {
    return x.includes(HONESTY_MARKER)
      ? { ok: true }
      : { ok: false, reason: "summary string does not contain HONESTY_MARKER" };
  }
  if (x && typeof x === "object") {
    const honesty = x.honesty;
    if (typeof honesty === "string" && honesty.includes(HONESTY_MARKER)) return { ok: true };
    if (typeof honesty !== "string" || !honesty) {
      return { ok: false, reason: "envelope has no non-empty honesty field" };
    }
    return { ok: false, reason: "envelope honesty field does not contain HONESTY_MARKER" };
  }
  return { ok: false, reason: "input is neither a string nor an object" };
}
