// isolation.mjs — persona tool isolation (panelist#72).
//
// A panelist persona reacts to an artifact as a cold reader — that signal is
// only meaningful if the persona knows nothing beyond the artifact and its own
// identity. Before this module, isolation was PROMPT-ENFORCED ONLY: if the host
// running spawn()/runPersona() (e.g. a general-purpose subagent with an MCP
// memory server attached) granted the persona ambient tools, nothing in
// panelist's code or output revealed it, and a contaminated verdict was
// indistinguishable from a clean one.
//
// This module is the deny/allow decision as an independent, testable unit —
// NOT inline in spawn.mjs's happy path. spawn.mjs (and, via it, runner.mjs)
// build a gate from this module and thread it through; score.mjs stamps the
// same envelope shape for symmetry across both execution planes.
//
// Design:
//   - Deny by default. spawn()/runPersona() grant NO tools unless opts.tools
//     names them explicitly.
//   - The allowlist is exact-match only. There is no wildcard, no category,
//     no "grant everything" shorthand — resolveEffectiveTools THROWS on one,
//     because a wildcard is exactly the shape that would silently re-open
//     discovery. Fail closed and loud, same posture as spawn's throwingClient.
//   - Closed under discovery. A tool-discovery/tool-search capability is
//     itself a tool (DISCOVERY_TOOLS lists common identifiers for it) — it is
//     never implicitly granted by granting some other tool, and must be named
//     explicitly like any other tool id to be permitted.
//   - Attempted-but-denied calls are reported, not swallowed: createToolGate's
//     check() records a denial (tool/reviewer/at) on refusal so a persona
//     reaching for a lookup is visible signal, not silently dropped.
//
// Pure, zero-dep ESM. Nothing here talks to a model or a real tool — an actual
// agentic adapter (deps.client) is responsible for calling gate.check() before
// dispatching a tool call, or for reporting its own denials via
// res.deniedToolCalls, which spawn.mjs merges in.

/**
 * Known identifiers for a tool-discovery/tool-search capability — the thing
 * that, if granted, would silently re-open the full tool set no matter what
 * else was denied. Not exhaustive (host tool-naming is not standardized);
 * used by tests to assert the invariant holds for the common shapes, and
 * available to callers who want to pre-screen a requested allowlist.
 */
export const DISCOVERY_TOOLS = Object.freeze([
  "tool-search",
  "tool_search",
  "toolsearch",
  "list-tools",
  "list_tools",
  "listtools",
  "discover-tools",
  "discover_tools",
  "discovertools",
  "search-tools",
  "search_tools",
]);

const WILDCARD_VALUES = new Set(["*", "all", "any"]);

const WILDCARD_ERROR =
  "panelist isolation: wildcard tool grants are not supported — list tools explicitly by id. " +
  "A tool-discovery/tool-search capability is itself a tool and must be named explicitly like " +
  "any other; it is never bundled by a wildcard (this is what keeps isolation closed under discovery).";

/**
 * Resolve a caller's requested tool list into the effective, deduped allowlist.
 * `undefined`/`null` (opts.tools omitted) resolves to `[]` — deny by default.
 * Throws on a wildcard/boolean grant or a malformed tool id; never silently
 * widens or narrows a mis-shaped request.
 * @param {undefined|null|string[]} requested
 * @returns {string[]}
 */
export function resolveEffectiveTools(requested) {
  if (requested === undefined || requested === null) return [];
  if (requested === true || (typeof requested === "string" && WILDCARD_VALUES.has(requested.toLowerCase()))) {
    throw new Error(WILDCARD_ERROR);
  }
  if (!Array.isArray(requested)) {
    throw new Error("panelist isolation: opts.tools must be an array of tool identifiers, or omitted for none.");
  }
  const tools = [];
  for (const t of requested) {
    if (typeof t !== "string" || !t.trim()) {
      throw new Error(`panelist isolation: invalid tool identifier ${JSON.stringify(t)} — tool ids must be non-empty strings.`);
    }
    if (WILDCARD_VALUES.has(t.trim().toLowerCase())) {
      throw new Error(WILDCARD_ERROR);
    }
    const id = t.trim();
    if (!tools.includes(id)) tools.push(id);
  }
  return tools;
}

/** Is `toolId` in the effective allowlist? Exact match only. */
export function isToolGranted(toolId, effectiveTools) {
  return typeof toolId === "string" && Array.isArray(effectiveTools) && effectiveTools.includes(toolId);
}

/** Build one denial record for the locked `isolation.denied[]` shape. */
export function recordDenial(toolId, reviewer, at) {
  return {
    tool: toolId,
    reviewer: reviewer == null ? null : String(reviewer),
    at: typeof at === "string" && at ? at : new Date().toISOString(),
  };
}

/**
 * Build a tool gate: the independently testable deny/allow unit spawn.mjs
 * (and any other caller) uses instead of inlining the decision. `check(toolId)`
 * both decides AND appends a denial record on refusal, so a caller can hand
 * the gate to an adapter and read `gate.denied` back afterward. `deps.toolGate`
 * lets multiple spawn() calls in one panel share a gate (and its denied log).
 * @param {object} [opts]
 *   @param {undefined|null|string[]} [opts.tools]  requested allowlist (see resolveEffectiveTools).
 *   @param {string} [opts.reviewer]  attributed on every denial this gate records.
 * @returns {{ tools: string[], check: (toolId: string) => boolean, denied: object[] }}
 */
export function createToolGate({ tools, reviewer } = {}) {
  const effectiveTools = resolveEffectiveTools(tools);
  const denied = [];
  return {
    tools: effectiveTools,
    check(toolId) {
      const allowed = isToolGranted(toolId, effectiveTools);
      if (!allowed) denied.push(recordDenial(toolId, reviewer));
      return allowed;
    },
    denied,
  };
}

/** Build the locked `isolation` envelope shape: `{ tools, denied }`. */
export function buildIsolationEnvelope(effectiveTools, denied) {
  return {
    tools: Array.isArray(effectiveTools) ? effectiveTools : [],
    denied: Array.isArray(denied) ? denied : [],
  };
}

/**
 * Union the `isolation.tools` of several per-persona records — for a caller
 * assembling a panel-level envelope out of N spawn() results, per the locked
 * shape's rule: "If tool sets differ per persona, top-level isolation.tools
 * is the union, and each per-persona record carries its own isolation.tools."
 * @param {Array<{isolation?: {tools?: string[]}}>} records
 * @returns {string[]}
 */
export function unionTools(records) {
  const set = new Set();
  for (const r of records || []) {
    const tools = r && r.isolation && Array.isArray(r.isolation.tools) ? r.isolation.tools : [];
    for (const t of tools) set.add(t);
  }
  return [...set];
}
