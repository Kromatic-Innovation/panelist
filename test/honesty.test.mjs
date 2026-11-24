import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HONESTY_MARKER,
  stampHonesty,
  formatPanelSummary,
  assertHonestyStamped,
} from "../src/lib/honesty.mjs";
import { USAGE_HEADER } from "../src/lib/schema.mjs";
import { getUsage, clearRegistry } from "../src/lib/register.mjs";

test("HONESTY_MARKER is a substring of the canonical USAGE_HEADER", () => {
  assert.ok(USAGE_HEADER.includes(HONESTY_MARKER));
});

test("stampHonesty adds a honesty field defaulting to the register/usage header", () => {
  clearRegistry();
  const envelope = { verdict: "cut" };
  const stamped = stampHonesty(envelope);
  assert.equal(stamped.honesty, getUsage());
  assert.ok(stamped.honesty.includes(HONESTY_MARKER));
});

test("stampHonesty does not mutate the input", () => {
  const envelope = { verdict: "keep" };
  const stamped = stampHonesty(envelope);
  assert.equal("honesty" in envelope, false);
  assert.notEqual(stamped, envelope);
});

test("stampHonesty is idempotent — re-stamping keeps a single honesty field", () => {
  const envelope = { verdict: "keep" };
  const once = stampHonesty(envelope, "custom usage line — not validation");
  const twice = stampHonesty(once, "custom usage line — not validation");
  assert.equal(Object.keys(twice).filter((k) => k === "honesty").length, 1);
  assert.equal(twice.honesty, "custom usage line — not validation");
});

test("stampHonesty accepts an explicit usage override", () => {
  const stamped = stampHonesty({}, "a custom caveat: not validation, not evidence");
  assert.equal(stamped.honesty, "a custom caveat: not validation, not evidence");
});

test("formatPanelSummary leads with verdict/cut-list framing, not a warmth score", () => {
  const evaluation = { verdict: "cut", aggregate: { overall: 3.2, clarity: 2, credibility: 5 } };
  const summary = formatPanelSummary(evaluation);
  assert.match(summary, /^CUT\./);
  assert.doesNotMatch(summary, /score of \d/i);
});

test("formatPanelSummary surfaces dealKillers when present (spawn-shaped input)", () => {
  const evaluation = { verdict: "cut", dealKillers: ["fabricated stat", "no source"] };
  const summary = formatPanelSummary(evaluation);
  assert.match(summary, /Deal-killers: fabricated stat; no source/);
});

test("formatPanelSummary falls back to weakest axis when no dealKillers array exists", () => {
  const evaluation = { verdict: "keep", aggregate: { overall: 7.1, clarity: 6, credibility: 9 } };
  const summary = formatPanelSummary(evaluation);
  assert.match(summary, /Weakest axis: clarity/);
});

test("formatPanelSummary ALWAYS contains HONESTY_MARKER", () => {
  const summaries = [
    formatPanelSummary({ verdict: "cut", aggregate: { overall: 1 } }),
    formatPanelSummary({ verdict: "keep", aggregate: { overall: 9 } }),
    formatPanelSummary({}),
    formatPanelSummary({ verdict: "keep", honesty: "already stamped — not validation" }),
  ];
  for (const s of summaries) assert.ok(s.includes(HONESTY_MARKER), s);
});

test("assertHonestyStamped: ok=true for a stamped string summary", () => {
  const summary = formatPanelSummary({ verdict: "cut", aggregate: { overall: 2 } });
  assert.deepEqual(assertHonestyStamped(summary), { ok: true });
});

test("assertHonestyStamped: ok=true for a stamped envelope object", () => {
  const stamped = stampHonesty({ verdict: "keep" });
  assert.deepEqual(assertHonestyStamped(stamped), { ok: true });
});

test("assertHonestyStamped: ok=false with a reason for an un-stamped envelope", () => {
  const result = assertHonestyStamped({ verdict: "keep" });
  assert.equal(result.ok, false);
  assert.equal(typeof result.reason, "string");
  assert.ok(result.reason.length > 0);
});

test("assertHonestyStamped: ok=false for a summary that drops the caveat", () => {
  const result = assertHonestyStamped("CUT. Weakest axis: clarity (2).");
  assert.equal(result.ok, false);
  assert.match(result.reason, /HONESTY_MARKER/);
});

test("assertHonestyStamped never throws on odd input", () => {
  assert.doesNotThrow(() => assertHonestyStamped(null));
  assert.doesNotThrow(() => assertHonestyStamped(undefined));
  assert.doesNotThrow(() => assertHonestyStamped(42));
  assert.equal(assertHonestyStamped(null).ok, false);
});

// ── panelist#242: a custom usage is appended to, never a replacement ───────
import { registerPersonas } from "../src/lib/register.mjs";
import { composeUsage } from "../src/lib/honesty.mjs";

test("no custom usage: honesty is exactly the standard header", () => {
  clearRegistry();
  assert.equal(stampHonesty({}).honesty, USAGE_HEADER);
  assert.equal(composeUsage(""), USAGE_HEADER);
});

test("custom usage without the marker: custom text first, then the standard caveat", () => {
  clearRegistry();
  registerPersonas({ usage: "Internal panel output." });
  const stamped = stampHonesty({ verdict: "cut" });
  assert.equal(stamped.honesty, `Internal panel output. ${USAGE_HEADER}`);
  assert.ok(stamped.honesty.startsWith("Internal panel output."));
  assert.equal(assertHonestyStamped(stamped).ok, true);
  assert.ok(formatPanelSummary({ verdict: "cut" }).includes(HONESTY_MARKER));
  assert.ok(formatPanelSummary({ verdict: "cut" }).includes("Internal panel output."));
  assert.equal(stampHonesty({}, "Explicit.").honesty, `Explicit. ${USAGE_HEADER}`);
  clearRegistry();
});

test("custom usage already containing the marker is not double-stamped", () => {
  clearRegistry();
  const custom = "House rules: this is not validation, only a pre-filter.";
  registerPersonas({ usage: custom });
  assert.equal(stampHonesty({}).honesty, custom);
  assert.equal(formatPanelSummary({ verdict: "keep" }).split(HONESTY_MARKER).length - 1, 1);
  assert.equal(assertHonestyStamped(stampHonesty({})).ok, true);
  clearRegistry();
});
