import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  registerPersonas,
  registerRubric,
  getPersona,
  getPersonas,
  getRubric,
  clearRegistry,
} from "../src/lib/register.mjs";
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
