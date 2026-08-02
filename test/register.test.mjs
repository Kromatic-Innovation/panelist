import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  registerPersonas,
  registerRubric,
  getPersona,
  getPersonas,
  getRubric,
  getUsage,
  clearRegistry,
} from "../src/lib/register.mjs";
import { SCHEMA_VERSION, USAGE_HEADER, PERSONA_SCHEMA, PERSONA_FIELDS, REQUIRED_FIELDS, validatePersona } from "../src/lib/schema.mjs";
import reviewPack from "../packs/review/index.mjs";
import businessPack from "../packs/business/index.mjs";

beforeEach(() => clearRegistry());

test("registerPersonas composes multiple sources in one call", () => {
  registerPersonas(reviewPack, businessPack);
  assert.equal(getPersonas().length, reviewPack.length + businessPack.length);
  assert.ok(getPersona("drive-by-installer"));
  assert.ok(getPersona("b2b-buyer"));
});

test("registerPersonas accumulates across calls and returns the roster", () => {
  registerPersonas(reviewPack);
  const after = registerPersonas(businessPack);
  assert.equal(after.length, reviewPack.length + businessPack.length);
});

test("registerPersonas accepts a single record", () => {
  const one = { id: "solo", name: "Solo", role: "r", caresAbout: ["x"], rewards: ["x"], punishes: ["x"], quitsWhen: ["x"] };
  registerPersonas(one);
  assert.equal(getPersona("solo").name, "Solo");
});

test("later sources override earlier ones by id (last-wins)", () => {
  registerPersonas([{ id: "dup", name: "First", role: "r", caresAbout: ["a"], rewards: ["a"], punishes: ["a"], quitsWhen: ["a"] }]);
  registerPersonas([{ id: "dup", name: "Second", role: "r", caresAbout: ["b"], rewards: ["b"], punishes: ["b"], quitsWhen: ["b"] }]);
  assert.equal(getPersonas().length, 1);
  assert.equal(getPersona("dup").name, "Second");
});

test("getPersona returns null for an unknown id", () => {
  registerPersonas(reviewPack);
  assert.equal(getPersona("nope"), null);
});

test("getPersonas filters by predicate and by field-match object", () => {
  registerPersonas(reviewPack);
  const byFn = getPersonas((p) => p.id === "production-evaluator");
  assert.equal(byFn.length, 1);
  const byObj = getPersonas({ id: "maintainers-maintainer" });
  assert.equal(byObj.length, 1);
  assert.equal(byObj[0].name, "Maintainer's maintainer");
});

test("registerPersonas throws on a malformed record", () => {
  assert.throws(
    () => registerPersonas([{ id: "bad", name: "Bad" }]),
    /invalid persona/,
  );
});

test("registerPersonas rejects demographics-as-steering", () => {
  assert.throws(
    () =>
      registerPersonas([
        { id: "d", name: "D", role: "r", caresAbout: ["a"], rewards: ["a"], punishes: ["a"], quitsWhen: ["a"], age: 40 },
      ]),
    /forbidden demographic field/,
  );
});

test("rubrics compose via source.rubrics and registerRubric", () => {
  registerPersonas({ personas: reviewPack, rubrics: { demo: { axes: ["a"], cut_threshold: 5 } } });
  assert.deepEqual(getRubric("demo").axes, ["a"]);
  registerRubric("other", { axes: ["b"] });
  assert.deepEqual(getRubric("other").axes, ["b"]);
  assert.equal(getRubric("missing"), null);
});

test("getUsage returns the canonical default when nothing is set", () => {
  registerPersonas(reviewPack);
  assert.equal(getUsage(), USAGE_HEADER);
});

test("a source's usage field overrides the default (last-wins)", () => {
  registerPersonas({ personas: reviewPack, usage: "custom honesty header for this registry" });
  assert.equal(getUsage(), "custom honesty header for this registry");
  registerPersonas({ personas: businessPack, usage: "second custom header" });
  assert.equal(getUsage(), "second custom header");
});

test("clearRegistry resets usage back to the canonical default", () => {
  registerPersonas({ personas: reviewPack, usage: "custom honesty header" });
  assert.equal(getUsage(), "custom honesty header");
  clearRegistry();
  assert.equal(getUsage(), USAGE_HEADER);
});

test("SCHEMA_VERSION and PERSONA_SCHEMA carry the v2 markers", () => {
  assert.equal(SCHEMA_VERSION, 2);
  assert.equal(PERSONA_SCHEMA.version, 2);
  assert.equal(PERSONA_SCHEMA.usage, USAGE_HEADER);
});

test("lens is optional/derived: records validate with or without it", () => {
  const withLens = {
    id: "with-lens",
    name: "With Lens",
    role: "r",
    caresAbout: ["a"],
    rewards: ["a"],
    punishes: ["a"],
    quitsWhen: ["a"],
    lens: "a derived synthesis line",
  };
  const withoutLens = {
    id: "without-lens",
    name: "Without Lens",
    role: "r",
    caresAbout: ["a"],
    rewards: ["a"],
    punishes: ["a"],
    quitsWhen: ["a"],
  };
  assert.equal(validatePersona(withLens).ok, true);
  assert.equal(validatePersona(withoutLens).ok, true);
});

test("a forbidden demographic field (age) is rejected by validatePersona", () => {
  const { ok, errors } = validatePersona({
    id: "demo",
    name: "Demo",
    role: "r",
    caresAbout: ["a"],
    rewards: ["a"],
    punishes: ["a"],
    quitsWhen: ["a"],
    age: 40,
  });
  assert.equal(ok, false);
  assert.ok(errors.some((e) => /forbidden demographic field/.test(e)));
});

// ── panelist#119: register-carried modelTier (companion to cwc#1879) ───────

test("modelTier does not appear in PERSONA_FIELDS or REQUIRED_FIELDS", () => {
  assert.ok(!PERSONA_FIELDS.includes("modelTier"));
  assert.ok(!REQUIRED_FIELDS.includes("modelTier"));
});

test("validatePersona accepts records with and without modelTier; every record valid today stays valid", () => {
  const withTier = {
    id: "with-tier",
    name: "With Tier",
    role: "r",
    caresAbout: ["a"],
    rewards: ["a"],
    punishes: ["a"],
    quitsWhen: ["a"],
    modelTier: "sonnet",
  };
  const withoutTier = {
    id: "without-tier",
    name: "Without Tier",
    role: "r",
    caresAbout: ["a"],
    rewards: ["a"],
    punishes: ["a"],
    quitsWhen: ["a"],
  };
  assert.equal(validatePersona(withTier).ok, true);
  assert.equal(validatePersona(withoutTier).ok, true);
  // Every persona in the shipped packs (valid today, no modelTier) stays valid.
  for (const p of [...reviewPack, ...businessPack]) {
    assert.equal(validatePersona(p).ok, true, `${p.id} should still validate`);
  }
});

test("registerPersonas stores a per-record modelTier verbatim, opaque and unvalidated", () => {
  registerPersonas([
    { id: "tiered", name: "Tiered", role: "r", caresAbout: ["a"], rewards: ["a"], punishes: ["a"], quitsWhen: ["a"], modelTier: "opus" },
  ]);
  assert.equal(getPersona("tiered").modelTier, "opus");
});

test("a source-level modelTier defaults every record from that source that doesn't set its own", () => {
  registerPersonas({
    personas: [
      { id: "no-own-tier", name: "A", role: "r", caresAbout: ["a"], rewards: ["a"], punishes: ["a"], quitsWhen: ["a"] },
      { id: "own-tier", name: "B", role: "r", caresAbout: ["a"], rewards: ["a"], punishes: ["a"], quitsWhen: ["a"], modelTier: "opus" },
    ],
    modelTier: "sonnet",
  });
  // per-record modelTier overrides the source default...
  assert.equal(getPersona("own-tier").modelTier, "opus");
  // ...but a record with no modelTier of its own picks up the source default.
  assert.equal(getPersona("no-own-tier").modelTier, "sonnet");
});

test("a source with no modelTier leaves records without the field entirely (today's behavior)", () => {
  registerPersonas(reviewPack);
  assert.equal("modelTier" in getPersona("drive-by-installer"), false);
});
