import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DISCOVERY_TOOLS,
  resolveEffectiveTools,
  isToolGranted,
  recordDenial,
  createToolGate,
  buildIsolationEnvelope,
  unionTools,
} from "../src/lib/isolation.mjs";

// ── resolveEffectiveTools ────────────────────────────────────────────────────

test("resolveEffectiveTools: omitted/undefined/null resolves to [] (deny by default)", () => {
  assert.deepEqual(resolveEffectiveTools(undefined), []);
  assert.deepEqual(resolveEffectiveTools(null), []);
});

test("resolveEffectiveTools: an explicit array is the effective allowlist (permitted)", () => {
  assert.deepEqual(resolveEffectiveTools(["web", "recall"]), ["web", "recall"]);
});

test("resolveEffectiveTools: dedupes and trims", () => {
  assert.deepEqual(resolveEffectiveTools([" web ", "web", "recall"]), ["web", "recall"]);
});

test("resolveEffectiveTools: throws on wildcard/boolean grants (no implicit 'everything')", () => {
  assert.throws(() => resolveEffectiveTools("*"), /wildcard/);
  assert.throws(() => resolveEffectiveTools("all"), /wildcard/);
  assert.throws(() => resolveEffectiveTools("ANY"), /wildcard/);
  assert.throws(() => resolveEffectiveTools(true), /wildcard/);
  assert.throws(() => resolveEffectiveTools(["web", "*"]), /wildcard/);
});

test("resolveEffectiveTools: throws on malformed tool ids", () => {
  assert.throws(() => resolveEffectiveTools([""]), /invalid tool identifier/);
  assert.throws(() => resolveEffectiveTools([42]), /invalid tool identifier/);
  assert.throws(() => resolveEffectiveTools("web"), /must be an array/);
});

test("resolveEffectiveTools: throws on a wildcard nested anywhere in the array, not just as the sole entry", () => {
  assert.throws(() => resolveEffectiveTools(["*"]), /wildcard/);
  assert.throws(() => resolveEffectiveTools(["web", "recall", "*"]), /wildcard/);
});

test("resolveEffectiveTools: throws on non-array object grant shapes (not just booleans/strings)", () => {
  assert.throws(() => resolveEffectiveTools({}), /must be an array/);
  assert.throws(() => resolveEffectiveTools({ tools: ["web"] }), /must be an array/);
  assert.throws(() => resolveEffectiveTools(new Proxy({}, {})), /must be an array/);
  assert.throws(() => resolveEffectiveTools(Symbol("all")), /must be an array/);
  assert.throws(() => resolveEffectiveTools(42), /must be an array/);
});

// ── isToolGranted / closed under discovery ───────────────────────────────────

test("isToolGranted: exact match only", () => {
  assert.equal(isToolGranted("web", ["web"]), true);
  assert.equal(isToolGranted("recall", ["web"]), false);
});

test("discovery capability is NOT implicitly grantable by granting some other tool", () => {
  const granted = resolveEffectiveTools(["web", "recall"]);
  for (const discoveryTool of DISCOVERY_TOOLS) {
    assert.equal(
      isToolGranted(discoveryTool, granted),
      false,
      `${discoveryTool} must not be reachable via an unrelated grant`,
    );
  }
});

test("a discovery capability CAN be granted, but only by naming it explicitly", () => {
  const granted = resolveEffectiveTools(["tool-search"]);
  assert.equal(isToolGranted("tool-search", granted), true);
  // still exact-match: a sibling discovery id is not swept in
  assert.equal(isToolGranted("list-tools", granted), false);
});

// ── recordDenial / buildIsolationEnvelope ────────────────────────────────────

test("recordDenial builds the locked {tool, reviewer, at} shape with an ISO timestamp", () => {
  const d = recordDenial("recall", "drive-by-installer");
  assert.equal(d.tool, "recall");
  assert.equal(d.reviewer, "drive-by-installer");
  assert.match(d.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

test("buildIsolationEnvelope always returns arrays, never undefined", () => {
  assert.deepEqual(buildIsolationEnvelope(undefined, undefined), { tools: [], denied: [] });
  assert.deepEqual(buildIsolationEnvelope(["web"], [{ tool: "recall", reviewer: "x", at: "t" }]), {
    tools: ["web"],
    denied: [{ tool: "recall", reviewer: "x", at: "t" }],
  });
});

// ── createToolGate: the exported, independently testable deny/allow unit ────

test("createToolGate: default (no tools) denies every check and records the attempt", () => {
  const gate = createToolGate({ reviewer: "drive-by-installer" });
  assert.deepEqual(gate.tools, []);
  assert.equal(gate.check("recall"), false);
  assert.deepEqual(gate.denied, [{ tool: "recall", reviewer: "drive-by-installer", at: gate.denied[0].at }]);
});

test("createToolGate: explicit allowlist permits a granted tool and does not record a denial", () => {
  const gate = createToolGate({ tools: ["recall"], reviewer: "drive-by-installer" });
  assert.equal(gate.check("recall"), true);
  assert.deepEqual(gate.denied, []);
});

test("createToolGate: granting one tool does not implicitly grant a discovery tool", () => {
  const gate = createToolGate({ tools: ["recall"], reviewer: "drive-by-installer" });
  assert.equal(gate.check("recall"), true);
  for (const discoveryTool of DISCOVERY_TOOLS) {
    assert.equal(gate.check(discoveryTool), false);
  }
  // every discovery attempt above was recorded as a denial, not swallowed
  assert.equal(gate.denied.length, DISCOVERY_TOOLS.length);
  assert.ok(gate.denied.every((d) => d.reviewer === "drive-by-installer"));
});

test("createToolGate: propagates resolveEffectiveTools' wildcard rejection", () => {
  assert.throws(() => createToolGate({ tools: "*" }), /wildcard/);
});

// ── unionTools ────────────────────────────────────────────────────────────

test("unionTools: unions isolation.tools across several per-persona records", () => {
  const records = [
    { isolation: { tools: ["web"] } },
    { isolation: { tools: ["recall", "web"] } },
    { isolation: { tools: [] } },
    {}, // no isolation field at all — tolerated
  ];
  assert.deepEqual(unionTools(records).sort(), ["recall", "web"]);
});

test("unionTools: empty input returns []", () => {
  assert.deepEqual(unionTools([]), []);
  assert.deepEqual(unionTools(undefined), []);
});
