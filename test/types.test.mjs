import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as entry from "../src/index.mjs";
import { fenceArtifact, quorumRequired } from "../src/index.mjs";

const dts = readFileSync(new URL("../src/index.d.ts", import.meta.url), "utf8");
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("fenceArtifact and quorumRequired are importable from the package entry (panelist#251)", () => {
  assert.equal(typeof fenceArtifact, "function");
  assert.equal(typeof quorumRequired, "function");
  assert.equal(fenceArtifact("x"), '"""x"""');
});

function declaredValueNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/^export\s+(?:declare\s+)?(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    names.add(m[1]);
  }
  return names;
}

test("index.d.ts declares exactly the runtime exports of src/index.mjs (drift)", () => {
  const runtime = new Set(Object.keys(entry));
  const declared = declaredValueNames(dts);
  const missing = [...runtime].filter((n) => !declared.has(n));
  const extra = [...declared].filter((n) => !runtime.has(n));
  assert.deepEqual(missing, [], `runtime exports missing from index.d.ts: ${missing}`);
  assert.deepEqual(extra, [], `index.d.ts declares non-runtime exports: ${extra}`);
});

test("package.json wires types before default", () => {
  assert.equal(pkg.types, "./src/index.d.ts");
  const keys = Object.keys(pkg.exports["."]);
  assert.ok(keys.indexOf("types") !== -1 && keys.indexOf("types") < keys.indexOf("default"));
  assert.equal(pkg.exports["."].types, "./src/index.d.ts");
  assert.ok(pkg.files.includes("src"));
});

// panelist#285: these four helpers are internal. The docs no longer call them
// exports, so neither the package entry nor index.d.ts may expose them. If one
// is ever promoted to the public API, update CHANGELOG/docs and this test together.
test("composeUsage, isEntryModule, DEFAULT_MAX_TURNS and FAILURE_SAMPLE_LIMIT stay internal (panelist#285)", async () => {
  const internal = {
    composeUsage: "../src/lib/honesty.mjs",
    isEntryModule: "../src/lib/drift-check.mjs",
    DEFAULT_MAX_TURNS: "../src/lib/junction-constants.mjs",
    FAILURE_SAMPLE_LIMIT: "../src/lib/score.mjs",
  };
  const declared = declaredValueNames(dts);
  for (const [name, mod] of Object.entries(internal)) {
    assert.ok(!(name in entry), `${name} must not be exported from src/index.mjs`);
    assert.ok(!declared.has(name), `${name} must not be declared in src/index.d.ts`);
    const lib = await import(mod);
    assert.notEqual(lib[name], undefined, `${name} should still exist in ${mod}`);
  }
  assert.deepEqual(Object.keys(pkg.exports).filter((k) => k.includes("lib")), [], "the exports map must not open src/lib/*");
});
