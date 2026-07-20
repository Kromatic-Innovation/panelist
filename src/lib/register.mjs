// register.mjs — runtime persona registry (ported from cwc#736, generalized).
//
// The internal register.mjs read a single bundled data/register.json. plenum has
// no bundled roster: consumers COMPOSE their own registry at runtime from one or
// more record sources (the shipped packs, plus their own private personas). So
// this exposes:
//
//   registerPersonas(...sources) -> composes sources into the in-memory registry
//   getPersona(id)               -> one persona, or null
//   getPersonas(filter?)         -> all personas, or a filtered subset
//   registerRubric(key, rubric)  -> register a named rubric
//   getRubric(key)               -> a rubric, or null
//   clearRegistry()              -> reset (test isolation)
//
// A "source" is one of:
//   - an array of persona records
//   - a single persona record
//   - an object { personas?: [...], rubrics?: { key: rubric } }
//
// Later sources override earlier ones by id (last-wins), so a consumer can layer
// a private override on top of a public pack. Unlike the file loader it replaces,
// registerPersonas FAILS FAST on a malformed record (a runtime compose call has a
// caller to hand the error to; a degrade-to-empty would hide the bug).
//
// Pure, zero-dep, no filesystem access.

import { validatePersona, isPersonaShaped } from "./schema.mjs";

const _personas = new Map(); // id -> record
const _rubrics = new Map(); // key -> rubric

/** Normalize a source into a flat list of candidate records + rubric entries. */
function* iterRecords(source) {
  if (source == null) return;
  if (Array.isArray(source)) {
    for (const r of source) yield r;
    return;
  }
  if (typeof source === "object") {
    if (Array.isArray(source.personas)) {
      for (const r of source.personas) yield r;
    }
    if (isPersonaShaped(source)) {
      yield source;
    }
  }
}

/**
 * Compose one or more record sources into the in-memory registry.
 * @param {...(object[]|object)} sources
 * @returns {object[]} all registered personas after this compose
 */
export function registerPersonas(...sources) {
  for (const source of sources) {
    // Rubrics travel alongside personas when a source carries them.
    if (source && !Array.isArray(source) && typeof source === "object" && source.rubrics) {
      for (const [key, rubric] of Object.entries(source.rubrics)) {
        _rubrics.set(key, rubric);
      }
    }
    for (const record of iterRecords(source)) {
      const { ok, errors } = validatePersona(record);
      if (!ok) {
        throw new Error(
          `plenum registerPersonas: invalid persona ${JSON.stringify(
            record && record.id,
          )}: ${errors.join("; ")}`,
        );
      }
      _personas.set(record.id, record);
    }
  }
  return getPersonas();
}

/** Register a named rubric (axes / killAxes / killFloor / cut_threshold). */
export function registerRubric(key, rubric) {
  if (typeof key !== "string" || !key) throw new Error("registerRubric: key must be a non-empty string");
  _rubrics.set(key, rubric);
  return rubric;
}

/**
 * Look up one persona by id.
 * @param {string} id
 * @returns {object|null}
 */
export function getPersona(id) {
  return _personas.get(id) || null;
}

/**
 * Return registered personas, optionally filtered.
 * @param {undefined|function|object} [filter]
 *   - undefined: all personas (declared/registration order)
 *   - function:  predicate (persona) => boolean
 *   - object:    shallow field-match, e.g. { role: "..." }
 * @returns {object[]}
 */
export function getPersonas(filter) {
  const all = [..._personas.values()];
  if (filter == null) return all;
  if (typeof filter === "function") return all.filter(filter);
  if (typeof filter === "object") {
    const entries = Object.entries(filter);
    return all.filter((p) => entries.every(([k, v]) => p[k] === v));
  }
  return all;
}

/**
 * Return a registered rubric, or null.
 * @param {string} key
 * @returns {object|null}
 */
export function getRubric(key) {
  return _rubrics.get(key) || null;
}

/** Reset the registry. Primarily for test isolation. */
export function clearRegistry() {
  _personas.clear();
  _rubrics.clear();
}
