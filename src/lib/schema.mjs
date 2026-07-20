// schema.mjs — the plenum persona schema (v1, behavioural).
//
// A plenum persona is identity-by-behaviour: what it cares about, rewards,
// punishes, and quits over — never demographics-as-steering. This module is the
// single source of truth for the record shape the loader, scorer, and
// drift-check all validate against.
//
// v2 (a formalized schema evolution) is deliberately NOT implemented here — that
// is a separate needs-decision slice (plenum#2). Keep this faithful to the shape
// the shipped example packs actually use.
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

// Human-readable schema description (mirrors data/register.json's _schema block,
// re-scoped to the behavioural shape).
export const PERSONA_SCHEMA = {
  description:
    "A plenum persona is a behavioural stand-in for a real reader/buyer: identity is what it cares about, rewards, punishes, and quits over — not demographics.",
  shape: "{ id, name, role, caresAbout[], rewards[], punishes[], quitsWhen[], lens? }",
  required: REQUIRED_FIELDS,
  forbidden: FORBIDDEN_FIELDS,
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
