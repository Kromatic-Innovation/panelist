// Guards docs/architecture.md against the module graph it claims to describe
// (panelist#182). The doc calls itself "a durable map ... it needs updating
// only when a module is added, removed, or re-layered" — but nothing made that
// true, so a module was added, the graph was re-layered around it, and three
// separate claims in the doc went stale without anything failing.
//
// This is the check that would have failed. It reads the doc and src/ and
// asserts they agree on four things: which modules exist, which imports exist,
// which layer each module sits in, and that the graph stays acyclic.
//
// This is the only file in the repo that touches node:fs, and it only reads.
// The no-I/O-in-src invariant is unaffected: nothing here ships in the package.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const repoUrl = (rel) => new URL(`../${rel}`, import.meta.url);
const read = (rel) => readFileSync(repoUrl(rel), "utf8");

// ── Pure parsers / checkers ────────────────────────────────────────────────
// Kept free of I/O so the negative controls at the bottom can drive them with
// synthetic input — a check nobody has watched fail is not a check.

/** Strip // line comments and block comments so prose can't fake an import. */
export function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Static relative imports (and re-exports) of one source file, as module names
 * without the `.mjs`. Dynamic `import()` is deliberately excluded — the doc
 * draws those as dotted edges, not dependency edges.
 *
 * Known limit: this reads text, not an AST, so `from "./x.mjs"` inside a string
 * or template literal would be counted as an import. That direction is a false
 * red — a spurious failure naming the phantom edge — not a missed drift, so it
 * is left as a regex. Reach for a parser only if it ever actually fires.
 */
export function importsOf(src) {
  const out = new Set();
  for (const [, spec] of stripComments(src).matchAll(/\bfrom\s+"(\.[^"]+)"/g)) {
    const base = spec.split("/").pop();
    if (base.endsWith(".mjs")) out.add(base.slice(0, -".mjs".length));
  }
  return [...out].sort();
}

/** Parse the ```mermaid block: declared nodes and solid (`-->`) edges. */
export function parseMermaid(doc) {
  const block = doc.match(/```mermaid\n([\s\S]*?)```/);
  assert.ok(block, "docs/architecture.md has no mermaid block");
  const idToModule = new Map();
  const edges = [];
  for (const raw of block[1].split("\n")) {
    const line = raw.trim();
    const decl = line.match(/^(\w+)\["([^"]+)"\]$/);
    if (decl) {
      const label = decl[2].split("<br/>")[0].trim();
      idToModule.set(decl[1], label.endsWith(".mjs") ? label.slice(0, -".mjs".length) : label);
      continue;
    }
    // `-.->` is an annotation edge (dynamic import); not a static dependency.
    const edge = line.match(/^(\w+)\s+-->\s+(.+)$/);
    if (edge) {
      for (const target of edge[2].split("&")) edges.push([edge[1], target.trim()]);
    }
  }
  const named = ([from, to]) => {
    assert.ok(idToModule.has(from), `mermaid edge from undeclared node "${from}"`);
    assert.ok(idToModule.has(to), `mermaid edge to undeclared node "${to}"`);
    return [idToModule.get(from), idToModule.get(to)];
  };
  return { modules: new Set(idToModule.values()), edges: edges.map(named) };
}

/**
 * Parse the layer table into `{ layerOf, allows }`. The "May import from"
 * column is machine-read: its `L<n>` tokens are the permitted layers, with
 * `nothing` and `all` as the two literals.
 */
export function parseLayers(doc) {
  const section = doc.match(/### Layers\n([\s\S]*?)\n## /);
  assert.ok(section, "docs/architecture.md has no ### Layers section");
  const layerOf = new Map();
  const allowsRaw = new Map();
  for (const line of section[1].split("\n")) {
    const row = line.match(/^\|\s*\*\*L(\d+)\*\*[^|]*\|([^|]*)\|([^|]*)\|/);
    if (!row) continue;
    const layer = Number(row[1]);
    for (const [, mod] of row[2].matchAll(/`([^`]+)`/g)) {
      const name = mod.endsWith(".mjs") ? mod.slice(0, -".mjs".length) : mod;
      assert.ok(!layerOf.has(name), `\`${name}\` is listed in more than one layer`);
      layerOf.set(name, layer);
    }
    allowsRaw.set(layer, row[3].trim());
  }
  assert.ok(layerOf.size > 0, "the layer table parsed to zero modules");
  const allLayers = [...allowsRaw.keys()];
  const allows = new Map();
  for (const [layer, cell] of allowsRaw) {
    if (/\ball\b/i.test(cell)) allows.set(layer, new Set(allLayers));
    else if (/\bnothing\b/i.test(cell)) allows.set(layer, new Set());
    else allows.set(layer, new Set([...cell.matchAll(/\bL(\d+)\b/g)].map((m) => Number(m[1]))));
  }
  return { layerOf, allows };
}

/** Every real edge whose target layer the source's layer does not permit. */
export function layerViolations(edges, { layerOf, allows }) {
  const bad = [];
  for (const [from, to] of edges) {
    if (!layerOf.has(from)) { bad.push(`\`${from}\` is not in the layer table`); continue; }
    if (!layerOf.has(to)) { bad.push(`\`${to}\` is not in the layer table`); continue; }
    const [a, b] = [layerOf.get(from), layerOf.get(to)];
    if (!allows.get(a).has(b)) {
      bad.push(`\`${from}\` (L${a}) imports \`${to}\` (L${b}), which L${a} may not import from`);
    }
  }
  return bad;
}

/** The first import cycle found, as a path, or null. */
export function findCycle(edges) {
  const out = new Map();
  for (const [from, to] of edges) out.set(from, [...(out.get(from) ?? []), to]);
  const state = new Map();
  let found = null;
  const walk = (node, path) => {
    if (found) return;
    if (state.get(node) === "open") { found = [...path.slice(path.indexOf(node)), node]; return; }
    if (state.get(node) === "done") return;
    state.set(node, "open");
    for (const next of out.get(node) ?? []) walk(next, [...path, next]);
    state.set(node, "done");
  };
  for (const node of out.keys()) walk(node, [node]);
  return found;
}

// ── The real graph, read off disk ──────────────────────────────────────────

const libModules = readdirSync(repoUrl("src/lib"))
  .filter((f) => f.endsWith(".mjs"))
  .map((f) => f.slice(0, -".mjs".length))
  .sort();

const realEdges = [
  ...importsOf(read("src/index.mjs")).map((to) => ["index", to]),
  ...libModules.flatMap((m) => importsOf(read(`src/lib/${m}.mjs`)).map((to) => [m, to])),
];

const doc = read("docs/architecture.md");
const mermaid = parseMermaid(doc);
const layers = parseLayers(doc);

const contractModules = new Set(
  [...(doc.match(/## Module contracts\n([\s\S]*?)\n## /)?.[1] ?? "").matchAll(/^\|\s*`([^`]+)`\s*\|/gm)]
    .map((m) => m[1]),
);

// ── The assertions ─────────────────────────────────────────────────────────

test("every src/lib module appears in the graph, the layer table and the contracts table", () => {
  for (const mod of libModules) {
    assert.ok(mermaid.modules.has(mod), `\`${mod}\` is missing from the mermaid graph`);
    assert.ok(layers.layerOf.has(mod), `\`${mod}\` is missing from the layer table`);
    assert.ok(contractModules.has(mod), `\`${mod}\` is missing from the module contracts table`);
  }
});

test("the doc names no module that src/lib does not have", () => {
  const real = new Set([...libModules, "index"]);
  for (const mod of layers.layerOf.keys()) {
    assert.ok(real.has(mod), `the layer table names \`${mod}\`, which is not a module in src/`);
  }
  for (const mod of contractModules) {
    assert.ok(real.has(mod), `the contracts table names \`${mod}\`, which is not a module in src/`);
  }
  // The graph too, or a node left behind by a rename drifts forever: it has no
  // edges to mismatch, so nothing else here would ever look at it. `packs/*` is
  // the one legitimate non-module node (the dotted dynamic-import target).
  for (const mod of mermaid.modules) {
    if (mod === "packs/*") continue;
    assert.ok(real.has(mod), `the mermaid graph declares \`${mod}\`, which is not a module in src/`);
  }
});

test("the mermaid graph's solid edges are exactly the real static imports", () => {
  const fmt = (es) => [...new Set(es.map(([a, b]) => `${a} --> ${b}`))].sort();
  assert.deepEqual(fmt(mermaid.edges), fmt(realEdges));
});

test("no module imports from a layer the table does not permit", () => {
  assert.deepEqual(layerViolations(realEdges, layers), []);
});

test("the module graph is acyclic", () => {
  const cycle = findCycle(realEdges);
  assert.equal(cycle, null, cycle ? `import cycle: ${cycle.join(" -> ")}` : "");
});

// ── Negative controls ──────────────────────────────────────────────────────
// panelist#182's counter-example: adding a new upward import to any src/lib
// module must make the check fail. These prove it does, without writing to disk.

test("an upward import is rejected by the layer check", () => {
  // `calibrate` (L2) importing `spawn` (L3) is upward; the real graph has no
  // such edge, so this can only fail if the checker is asleep.
  const injected = [...realEdges, ["calibrate", "spawn"]];
  const violations = layerViolations(injected, layers);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /`calibrate` \(L2\) imports `spawn` \(L3\)/);
});

test("an import of a module missing from the layer table is rejected", () => {
  assert.deepEqual(layerViolations([["score", "not-a-module"]], layers), [
    "`not-a-module` is not in the layer table",
  ]);
});

test("the cycle check finds a reintroduced junction/junction-schema cycle", () => {
  // The exact drift this test exists for: the cycle panelist#89 removed.
  assert.equal(findCycle(realEdges), null);
  const cycle = findCycle([...realEdges, ["junction-schema", "junction"]]);
  assert.ok(cycle, "a reintroduced cycle went undetected");
  assert.ok(cycle.includes("junction") && cycle.includes("junction-schema"), cycle.join(" -> "));
});

test("importsOf reads real imports and ignores comments and dynamic imports", () => {
  const src = `
// import { fake } from "./not-real.mjs";
/* from "./also-not-real.mjs" */
import { a } from "./alpha.mjs";
export { b } from "./lib/beta.mjs";
import "./gamma.mjs";
const late = await import("./delta.mjs");
import fs from "node:fs";
`;
  // `import "./gamma.mjs"` and `import("./delta.mjs")` have no \`from\`, so
  // neither is counted; node: builtins are not relative and are skipped.
  assert.deepEqual(importsOf(src), ["alpha", "beta"]);
});
