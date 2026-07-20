// schema.mjs — the panelist persona schema (v2, behavioural).
//
// A panelist persona is identity-by-behaviour: what it cares about, rewards,
// punishes, and quits over — never demographics-as-steering. This module is the
// single source of truth for the record shape the loader, scorer, and
// drift-check all validate against.
//
// v2 (panelist#2) is landed: the behavioural triple (rewards/punishes/quitsWhen)
// is the required identity core; `lens` remains an optional DERIVED-SYNTHESIS
// line layered on top (not a primary identity field, not required); and the
// register carries a `usage` honesty header (see USAGE_HEADER) so every
// composed registry states panelist's drafting-aid/pre-filter stance by default.
//
// Pure, zero-dep ESM.

// Identity-bearing fields. Order is the canonical render/report order.
export const PERSONA_FIELDS = [
  "id",
  "name",
  "role",
  "caresAbout",
  "rewards",
  "punishes",
  "quitsWhen",
  "lens",
];

// Fields a valid record MUST carry (non-empty).
export const REQUIRED_FIELDS = ["id", "name", "role", "caresAbout", "rewards", "punishes", "quitsWhen"];

// Fields that MUST be non-empty string arrays when present.
const ARRAY_FIELDS = ["caresAbout", "rewards", "punishes", "quitsWhen"];

// Demographics-as-steering is forbidden: identity is behaviour, not category.
export const FORBIDDEN_FIELDS = ["age", "employer", "company", "tenure"];

// Schema version marker. Bump when the persona record shape changes in a way
// downstream consumers should be able to detect/branch on.
export const SCHEMA_VERSION = 2;

// Canonical register-level honesty header (README "What panelist is and is not
// for" / docs/synthetic-persona-best-practices.md §6). This is the DEFAULT
// usage caveat a registry carries when a source doesn't supply its own — see
// register.mjs's getUsage(). Synthetic personas are a drafting aid and a cheap
// pre-filter; they are not evidence about real users, not user research, and
// not validation.
export const USAGE_HEADER =
  "Synthetic personas are a drafting aid and a cheap pre-filter — not evidence about real users, not user research, and not validation. \"Our personas responded well to this\" is a sentence this tool is designed to make hard to write.";

// Human-readable schema description (mirrors data/register.json's _schema block,
// re-scoped to the behavioural shape).
export const PERSONA_SCHEMA = {
  version: SCHEMA_VERSION,
  description:
    "A panelist persona is a behavioural stand-in for a real reader/buyer: identity is what it cares about, rewards, punishes, and quits over — not demographics.",
  shape: "{ id, name, role, caresAbout[], rewards[], punishes[], quitsWhen[], lens? }",
  required: REQUIRED_FIELDS,
  forbidden: FORBIDDEN_FIELDS,
  // `lens` is an optional derived-synthesis line layered on the behavioural
  // triple — not a primary identity field, never required.
  derived: ["lens"],
  usage: USAGE_HEADER,
};

/**
 * Validate one persona record against the schema.
 * @param {object} record
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validatePersona(record) {
  const errors = [];
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return { ok: false, errors: ["record is not an object"] };
  }
  if (typeof record.id !== "string" || !record.id.trim()) {
    errors.push("id must be a non-empty string");
  }
  for (const field of REQUIRED_FIELDS) {
    if (field === "id") continue;
    if (!(field in record)) {
      errors.push(`missing required field: ${field}`);
      continue;
    }
    if (ARRAY_FIELDS.includes(field)) {
      const v = record[field];
      if (!Array.isArray(v) || v.length === 0) {
        errors.push(`${field} must be a non-empty array`);
      } else if (!v.every((x) => typeof x === "string" && x.trim())) {
        errors.push(`${field} must contain only non-empty strings`);
      }
    } else if (typeof record[field] !== "string" || !record[field].trim()) {
      errors.push(`${field} must be a non-empty string`);
    }
  }
  for (const field of FORBIDDEN_FIELDS) {
    if (field in record) errors.push(`forbidden demographic field present: ${field}`);
  }
  return { ok: errors.length === 0, errors };
}

/** True when the value looks like a persona record (has an id + one identity field). */
export function isPersonaShaped(o) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return false;
  if (typeof o.id !== "string" || !o.id) return false;
  return "lens" in o || "caresAbout" in o || "rewards" in o || "role" in o;
}
