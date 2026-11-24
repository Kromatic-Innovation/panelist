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

// panelist#237: the CLI must run only when drift-check is the real entry module.
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { isEntryModule, main } from "../src/lib/drift-check.mjs";

const DRIFT_PATH = fileURLToPath(new URL("../src/lib/drift-check.mjs", import.meta.url));
const INDEX_URL = new URL("../src/index.mjs", import.meta.url).href;

test("a consumer script named drift-check.mjs keeps its own exit code and output", async () => {
  const dir = await mkdtemp(join(tmpdir(), "panelist-drift-"));
  try {
    const file = join(dir, "drift-check.mjs");
    await writeFile(
      file,
      `import { checkRecords } from ${JSON.stringify(INDEX_URL)};
checkRecords([]);
setTimeout(() => { console.log("CONSUMER-SENTINEL"); process.exitCode = 3; }, 50);
`,
    );
    const r = spawnSync(process.execPath, [file], { encoding: "utf8", timeout: 30000 });
    assert.equal(r.status, 3);
    assert.match(r.stdout, /CONSUMER-SENTINEL/);
    assert.doesNotMatch(r.stdout, /no drift|DRIFT DETECTED/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("running drift-check.mjs directly still prints its report and exits 0 when clean", () => {
  const r = spawnSync(process.execPath, [DRIFT_PATH], { encoding: "utf8", timeout: 30000 });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /no drift/);
});

test("isEntryModule: true only for the real entry; false for undefined argv[1] or another script", () => {
  const me = pathToFileURL(DRIFT_PATH).href;
  assert.equal(isEntryModule(me, DRIFT_PATH), true);
  assert.equal(isEntryModule(me, undefined), false);
  assert.equal(isEntryModule(me, "/nonexistent/drift-check.mjs"), false);
  assert.equal(isEntryModule(me, fileURLToPath(import.meta.url)), false);
});

test("main() resolves non-zero on drift (the exit-1 path of npm run drift)", async () => {
  const bad = { id: "b", name: "B", role: "r", caresAbout: "nope", rewards: [], punishes: [], quitsWhen: [] };
  const orig = console.log;
  console.log = () => {};
  try {
    assert.equal(await main([[bad]]), 1);
  } finally {
    console.log = orig;
  }
});
