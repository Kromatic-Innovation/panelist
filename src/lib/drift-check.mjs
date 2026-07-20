// drift-check.mjs — repo-scoped persona schema validator.
//
// The internal drift-check walked a whole monorepo (DEFAULT_ROOT_DIR) hunting for
// inline copies that had drifted from a central register. panelist has no central
// register and no monorepo to scan: the records ARE the source of truth. So this
// is re-scoped to validate THIS repo's own records against the schema
// (schema.mjs) and flag duplicate ids. Wired to `npm run drift`.
//
// Pure, injectable, zero-dep ESM. Nothing throws on bad input — an invalid record
// is reported, not thrown.
//
// D7 (resolved, panelist#6): drift-check does NOT retarget to "register-vs-
// rendered-prompt" — after persona-as-subagent (cwc#1262) and the generic
// runner (runner.mjs / D5), identity is rendered LIVE from the register at
// call time, so there is no second static copy to drift against there.
// Instead this module KEEPS its record-schema validation role and GAINS one
// new guardrail: checkHonesty, which proves no panel summary/envelope omits
// the honesty caveat (honesty.mjs). See
// Kromatic-Innovation/code-workspace-config#1262.

import { validatePersona } from "./schema.mjs";
import { assertHonestyStamped } from "./honesty.mjs";

// validatePersona is schema-driven (schema.mjs), so this already enforces the
// v2 shape as a side effect: the behavioural triple (rewards/punishes/quitsWhen)
// required, `lens` optional/derived, forbidden demographic fields rejected. No
// v2-specific logic belongs here — it would just duplicate schema.mjs.

/**
 * Validate a flat list of records against the schema and flag duplicate ids.
 * @param {object[]} records
 * @returns {{ ok, checked, valid: string[], invalid: {id,errors}[], duplicateIds: string[] }}
 */
export function checkRecords(records) {
  const list = Array.isArray(records) ? records : [];
  const valid = [];
  const invalid = [];
  const seen = new Map();
  const duplicateIds = new Set();

  for (const record of list) {
    const { ok, errors } = validatePersona(record);
    const id = record && typeof record.id === "string" ? record.id : "(no id)";
    if (ok) valid.push(id);
    else invalid.push({ id, errors });

    if (record && typeof record.id === "string") {
      seen.set(record.id, (seen.get(record.id) || 0) + 1);
      if (seen.get(record.id) > 1) duplicateIds.add(record.id);
    }
  }

  return {
    ok: invalid.length === 0 && duplicateIds.size === 0,
    checked: list.length,
    valid,
    invalid,
    duplicateIds: [...duplicateIds],
  };
}

/**
 * Honesty-stamp guardrail (panelist#6 / D7): check a batch of panel summaries
 * (strings) or envelopes (objects) and report which ones (by index) omit the
 * honesty caveat. Never throws — delegates to assertHonestyStamped per item.
 * @param {Array<string|object>} summaries
 * @returns {{ ok: boolean, offenders: number[] }}
 */
export function checkHonesty(summaries) {
  const list = Array.isArray(summaries) ? summaries : [];
  const offenders = [];
  list.forEach((item, i) => {
    const { ok } = assertHonestyStamped(item);
    if (!ok) offenders.push(i);
  });
  return { ok: offenders.length === 0, offenders };
}

/** Render a check report as a human-readable string. */
export function formatReport(report) {
  if (report.ok) {
    return `OK — ${report.checked} record(s) valid, no drift.`;
  }
  const lines = [
    `DRIFT DETECTED — ${report.invalid.length} invalid, ${report.duplicateIds.length} duplicate id(s).`,
  ];
  for (const { id, errors } of report.invalid) {
    lines.push(`  [invalid] ${id}: ${errors.join("; ")}`);
  }
  for (const id of report.duplicateIds) {
    lines.push(`  [duplicate] ${id} appears more than once`);
  }
  return lines.join("\n");
}

/**
 * Load this repo's shipped example packs and validate them.
 * @param {object[]} [packs]  inject record arrays for tests; defaults to the
 *   review + business packs.
 * @returns {Promise<object>} checkRecords report
 */
export async function scanRepo(packs) {
  let records;
  if (Array.isArray(packs)) {
    records = packs.flat();
  } else {
    const [review, business] = await Promise.all([
      import("../../packs/review/index.mjs"),
      import("../../packs/business/index.mjs"),
    ]);
    records = [...review.default, ...business.default];
  }
  return checkRecords(records);
}

/** CLI entry: scan the repo's packs, print, resolve to 0/1. */
export async function main() {
  const report = await scanRepo();
  // eslint-disable-next-line no-console
  console.log(formatReport(report));
  return report.ok ? 0 : 1;
}

// Run as a script: `node src/lib/drift-check.mjs`
if (process.argv[1]) {
  const invoked = process.argv[1].replace(/\\/g, "/");
  if (invoked.endsWith("drift-check.mjs")) {
    main().then((code) => process.exit(code));
  }
}
