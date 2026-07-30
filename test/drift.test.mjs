import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRecords, scanRepo, formatReport } from "../src/lib/drift-check.mjs";
import reviewPack from "../packs/review/index.mjs";
import businessPack from "../packs/business/index.mjs";

test("a good record passes the schema check", () => {
  const good = { id: "g", name: "G", role: "r", caresAbout: ["a"], rewards: ["a"], punishes: ["a"], quitsWhen: ["a"], lens: "x" };
  const report = checkRecords([good]);
  assert.equal(report.ok, true);
  assert.equal(report.invalid.length, 0);
  assert.deepEqual(report.valid, ["g"]);
});

test("a bad record is flagged with per-field errors", () => {
  const bad = { id: "b", name: "B", role: "r", caresAbout: "not-an-array", rewards: [], punishes: ["a"], quitsWhen: ["a"] };
  const report = checkRecords([bad]);
  assert.equal(report.ok, false);
  assert.equal(report.invalid[0].id, "b");
  assert.ok(report.invalid[0].errors.some((e) => /caresAbout/.test(e)));
  assert.ok(report.invalid[0].errors.some((e) => /rewards/.test(e)));
});

test("duplicate ids are detected", () => {
  const one = { id: "x", name: "X", role: "r", caresAbout: ["a"], rewards: ["a"], punishes: ["a"], quitsWhen: ["a"] };
  const report = checkRecords([one, { ...one }]);
  assert.equal(report.ok, false);
  assert.deepEqual(report.duplicateIds, ["x"]);
});

test("the shipped packs pass drift-check clean", async () => {
  const report = await scanRepo([reviewPack, businessPack]);
  assert.equal(report.ok, true, JSON.stringify(report.invalid));
  assert.equal(report.checked, reviewPack.length + businessPack.length);
});

// CI gate proof (#83): `npm run drift` is only a real gate if a broken
// record actually flips the report — and thus the CLI's process.exit(1) —
// to failing. This constructs a deliberately-broken pack (valid records
// plus one record with a bad `caresAbout` type and a missing `quitsWhen`)
// and asserts scanRepo reports failure, mirroring exactly what `main()` in
// drift-check.mjs does before resolving to a non-zero exit code.
test("a deliberately-broken pack fails the drift gate (CI gate proof, #83)", async () => {
  const broken = {
    id: "broken-record",
    name: "Broken",
    role: "r",
    caresAbout: "not-an-array",
    rewards: ["a"],
    punishes: ["a"],
  };

  const brokenReport = await scanRepo([reviewPack, businessPack, [broken]]);
  assert.equal(brokenReport.ok, false);
  assert.ok(brokenReport.invalid.some((entry) => entry.id === "broken-record"));
  assert.ok(/caresAbout/.test(formatReport(brokenReport)));

  // Same inputs minus the broken record: proves the failure above is
  // attributable to the broken record, not to some other repo drift.
  const cleanReport = await scanRepo([reviewPack, businessPack]);
  assert.equal(cleanReport.ok, true);
});
