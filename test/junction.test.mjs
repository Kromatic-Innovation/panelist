import { test } from "node:test";
import assert from "node:assert/strict";
import { runJunctionLoop, BAIL } from "../src/lib/junction.mjs";
import { createToolGate } from "../src/lib/isolation.mjs";

// A scripted persona client: captures every prompt it is handed, and answers with
// a turn-ordered sequence of { reaction, decision } payloads (the loop is strictly
// sequential, so turn order fully determines the traversal). Same injected-client
// shape spawn.mjs uses: complete({prompt}) -> { ok, text, model }.
function scriptedClient(responses, captured) {
  let i = 0;
  return {
    model: "scripted",
    async complete({ prompt }) {
      captured.push(prompt);
      const r = responses[i] ?? { reaction: "(exhausted script)", decision: BAIL };
      i += 1;
      return { ok: true, text: JSON.stringify(r), model: "scripted" };
    },
  };
}

const SENTINEL = "SENTINEL-DO-NOT-LEAK-7f3a";

// Hub-and-spoke graph with a back-edge — mirrors jauss's the-index hub. `spokeSecret`
// is a real navigable option (its LABEL shows in the menu) but the persona never
// chooses it, so its CONTENT (which carries the sentinel) must never be revealed.
function hubGraph() {
  return {
    entry: "hub",
    junctions: {
      hub: {
        content: "INDEX-HUB-CONTENT: pick a spoke.",
        decisions: () => [
          { id: "spokeA", label: "Read spoke A" },
          { id: "spokeB", label: "Read spoke B" },
          { id: "spokeSecret", label: "Read the secret spoke" },
        ],
      },
      spokeA: {
        content: "SPOKE-A-CONTENT: the first spoke body.",
        decisions: () => [{ id: "hub", label: "Back to the index" }],
      },
      spokeB: {
        content: "SPOKE-B-CONTENT: the second spoke body.",
        decisions: () => [{ id: "hub", label: "Back to the index" }],
      },
      spokeSecret: {
        content: `SPOKE-SECRET-CONTENT: ${SENTINEL} — this must never leak into a prompt.`,
        decisions: () => [{ id: "hub", label: "Back to the index" }],
      },
    },
  };
}

// Pure linear chain — mirrors the blog hook->intro->body shape. `body` offers no
// forward decisions, so reaching it ends the run as "terminal" with no special-casing.
function chainGraph() {
  return {
    entry: "hook",
    junctions: {
      hook: { content: "HOOK-CONTENT", decisions: () => [{ id: "intro", label: "Keep reading" }] },
      intro: { content: "INTRO-CONTENT", decisions: () => [{ id: "body", label: "Get to the point" }] },
      body: { content: "BODY-CONTENT", decisions: () => [] },
    },
  };
}

const READER = { id: "reader", name: "Skimming Reader", role: "impatient web reader", caresAbout: ["speed"] };

const HUB_WALK = [
  { reaction: "at the hub, I'll try A", decision: "spokeA" },
  { reaction: "read A, back to the index", decision: "hub" },
  { reaction: "at the hub, now B", decision: "spokeB" },
  { reaction: "read B, back to the index", decision: "hub" },
  { reaction: "seen enough", decision: BAIL },
];

for (const strategy of ["persistent", "respawn"]) {
  test(`[${strategy}] hub-and-spoke: branching + back-edge revisits work end to end`, async () => {
    const captured = [];
    const client = scriptedClient(HUB_WALK, captured);
    const out = await runJunctionLoop(hubGraph(), READER, { spawnStrategy: strategy, client, horizon: "web" });

    assert.equal(out.strategy, strategy);
    assert.equal(out.stopReason, "bail");
    assert.equal(out.turns, 5);
    // hub visited three times (revisits via the back-edge); both spokes visited (branching).
    assert.deepEqual(
      out.path.map((p) => p.junctionId),
      ["hub", "spokeA", "hub", "spokeB", "hub"],
    );
    // The persona identity is rendered into the prompt.
    assert.ok(captured[0].includes("Skimming Reader"));
  });

  test(`[${strategy}] barrier: an unchosen junction's content never enters ANY prompt`, async () => {
    const captured = [];
    const client = scriptedClient(HUB_WALK, captured);
    await runJunctionLoop(hubGraph(), READER, { spawnStrategy: strategy, client });

    // Positive control: chosen content WAS shown.
    assert.ok(captured.some((p) => p.includes("SPOKE-A-CONTENT")));
    assert.ok(captured.some((p) => p.includes("SPOKE-B-CONTENT")));
    // The barrier: the never-chosen junction's content — and its sentinel — never leaked,
    // even though its navigation LABEL was offered at the hub every turn.
    for (const prompt of captured) {
      assert.ok(!prompt.includes(SENTINEL), "sentinel leaked into a prompt");
      assert.ok(!prompt.includes("SPOKE-SECRET-CONTENT"), "unchosen content leaked into a prompt");
    }
  });

  test(`[${strategy}] linear chain: the same engine handles hook->intro->body with no special-casing`, async () => {
    const captured = [];
    const client = scriptedClient(
      [
        { reaction: "hooked", decision: "intro" },
        { reaction: "still reading", decision: "body" },
        { reaction: "done", decision: BAIL }, // body is terminal; this is never consulted for navigation
      ],
      captured,
    );
    const out = await runJunctionLoop(chainGraph(), "A plain reader.", { spawnStrategy: strategy, client });

    assert.equal(out.stopReason, "terminal");
    assert.deepEqual(
      out.path.map((p) => p.junctionId),
      ["hook", "intro", "body"],
    );
  });

  test(`[${strategy}] bail is reachable from EVERY junction and ends the run cleanly`, async () => {
    for (const graph of [hubGraph(), chainGraph()]) {
      for (const jid of Object.keys(graph.junctions)) {
        const captured = [];
        const client = scriptedClient([{ reaction: "no thanks", decision: BAIL }], captured);
        const out = await runJunctionLoop({ ...graph, entry: jid }, READER, { spawnStrategy: strategy, client });
        // The bail option is offered at every junction and always ends the run in one
        // clean turn. At a junction with a way forward the reply is honored as "bail";
        // at a terminal junction (no way forward) the same clean stop reports "terminal".
        assert.ok(["bail", "terminal"].includes(out.stopReason), `bail from ${jid} should end cleanly`);
        assert.equal(out.turns, 1);
        assert.equal(out.path[0].decision, BAIL);
        // The bail option was actually presented to the persona at this junction.
        assert.ok(captured[0].includes(`${BAIL}:`), `bail option should be offered at ${jid}`);
      }
    }
  });

  test(`[${strategy}] patience exhaustion ends the run and is distinguishable from an explicit bail`, async () => {
    const captured = [];
    // Persona never bails — always ping-pongs hub<->spokeA. Budget of 3 must run out.
    const client = scriptedClient(
      [
        { reaction: "1", decision: "spokeA" },
        { reaction: "2", decision: "hub" },
        { reaction: "3", decision: "spokeA" },
        { reaction: "4", decision: "hub" },
      ],
      captured,
    );
    const out = await runJunctionLoop(hubGraph(), READER, { spawnStrategy: strategy, client, patienceBudget: 3 });

    assert.equal(out.stopReason, "budget-exhausted");
    assert.notEqual(out.stopReason, "bail");
    assert.equal(out.turns, 3);
    assert.equal(out.budgetRemaining, 0);
  });
}

// Strategy-distinguishing behavior: persistent re-sends prior junction CONTENT
// (an accumulating conversation); respawn re-hydrates only a compact transcript.
test("persistent accumulates prior junction content; respawn does not", async () => {
  const persistentCaptured = [];
  await runJunctionLoop(hubGraph(), READER, {
    spawnStrategy: "persistent",
    client: scriptedClient(HUB_WALK, persistentCaptured),
    horizon: "web",
  });
  // The 3rd hub visit (turn index 4) re-sends spoke A's body seen back on turn 2.
  assert.ok(persistentCaptured[4].includes("SPOKE-A-CONTENT"));

  const respawnCaptured = [];
  await runJunctionLoop(hubGraph(), READER, {
    spawnStrategy: "respawn",
    client: scriptedClient(HUB_WALK, respawnCaptured),
    horizon: "web",
  });
  // Respawn carries a transcript summary, not the prior contents, and threads the horizon.
  assert.ok(respawnCaptured[4].includes("TRANSCRIPT SO FAR"));
  assert.ok(respawnCaptured[4].includes("web"));
  assert.ok(!respawnCaptured[4].includes("SPOKE-A-CONTENT"));
});

// The patience rate is configurable by the graph (per-junction cost) and the budget
// can be seeded from the horizon via graph.patience(horizon).
test("graph seeds patience from the horizon and per-junction cost sets the burn rate", async () => {
  const graph = hubGraph();
  graph.patience = (horizon) => (horizon === "web" ? 2 : 20);
  graph.junctions.hub.cost = 2; // engaging the hub burns two units

  const captured = [];
  const client = scriptedClient([{ reaction: "hi", decision: "spokeA" }], captured);
  // Budget seeded to 2 from horizon "web"; the hub costs 2, so exactly one turn fits,
  // then spokeA (cost 1) is unaffordable -> budget-exhausted after a single hub turn.
  const out = await runJunctionLoop(graph, READER, { spawnStrategy: "persistent", client, horizon: "web" });
  assert.equal(out.turns, 1);
  assert.equal(out.stopReason, "budget-exhausted");
});

test("a hallucinated decision id ends the run cleanly rather than looping", async () => {
  const captured = [];
  const client = scriptedClient([{ reaction: "go", decision: "no-such-junction" }], captured);
  const out = await runJunctionLoop(hubGraph(), READER, { spawnStrategy: "persistent", client });
  assert.equal(out.stopReason, "invalid-decision");
  assert.equal(out.turns, 1);
});

test("input validation: bad strategy, missing client, unknown entry all throw", async () => {
  const client = scriptedClient([], []);
  await assert.rejects(() => runJunctionLoop(hubGraph(), READER, { spawnStrategy: "bogus", client }), /spawnStrategy must be one of/);
  await assert.rejects(() => runJunctionLoop(hubGraph(), READER, { spawnStrategy: "persistent" }), /inject a client/);
  await assert.rejects(
    () => runJunctionLoop({ ...hubGraph(), entry: "nope" }, READER, { spawnStrategy: "persistent", client }),
    /entry .* is not a junction/,
  );
});

// ── Tool isolation (panelist#75) ─────────────────────────────────────────────

/** A client that CONSULTS the granted tools array: attempts "recall" every turn,
 * reporting it as denied via deniedToolCalls whenever it is not in `tools`. */
function toolAttemptingClient(responses) {
  let i = 0;
  return {
    model: "scripted-tool-attempting",
    async complete({ tools }) {
      const r = responses[i] ?? { reaction: "(exhausted script)", decision: BAIL };
      i += 1;
      const granted = Array.isArray(tools) && tools.includes("recall");
      const deniedToolCalls = granted ? [] : ["recall"];
      return { ok: true, text: JSON.stringify(r), model: "scripted-tool-attempting", deniedToolCalls };
    },
  };
}

test("default (no opts.tools) denies an attempted tool and surfaces it in isolation.denied", async () => {
  const client = toolAttemptingClient([{ reaction: "seen enough", decision: BAIL }]);
  const out = await runJunctionLoop(chainGraph(), READER, { spawnStrategy: "persistent", client });
  assert.deepEqual(out.isolation.tools, []);
  assert.equal(out.isolation.denied.length, 1);
  assert.equal(out.isolation.denied[0].tool, "recall");
  assert.match(out.isolation.denied[0].at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

test("explicit opts.tools allowlist permits the granted tool (no denial recorded)", async () => {
  const client = toolAttemptingClient([{ reaction: "seen enough", decision: BAIL }]);
  const out = await runJunctionLoop(chainGraph(), READER, { spawnStrategy: "persistent", client, tools: ["recall"] });
  assert.deepEqual(out.isolation.tools, ["recall"]);
  assert.deepEqual(out.isolation.denied, []);
});

test("opts.tools wildcard throws via resolveEffectiveTools", async () => {
  const client = scriptedClient([{ reaction: "go", decision: BAIL }], []);
  await assert.rejects(
    () => runJunctionLoop(chainGraph(), READER, { spawnStrategy: "persistent", client, tools: "*" }),
    /wildcard/,
  );
  await assert.rejects(
    () => runJunctionLoop(chainGraph(), READER, { spawnStrategy: "persistent", client, tools: ["recall", "*"] }),
    /wildcard/,
  );
});

test("opts.toolGate lets a caller share one gate (and its denied log) across calls", async () => {
  const gate = createToolGate({ tools: ["recall"], reviewer: "shared" });
  const client = toolAttemptingClient([{ reaction: "seen enough", decision: BAIL }]);
  const out = await runJunctionLoop(chainGraph(), READER, { spawnStrategy: "persistent", client, toolGate: gate });
  assert.deepEqual(out.isolation.tools, ["recall"]);
  assert.deepEqual(out.isolation.denied, []);
});

test("isolation is present on every early-return/bail path: bail, budget-exhausted, terminal, invalid-decision", async () => {
  // bail
  {
    const client = toolAttemptingClient([{ reaction: "no thanks", decision: BAIL }]);
    const out = await runJunctionLoop(hubGraph(), READER, { spawnStrategy: "persistent", client });
    assert.equal(out.stopReason, "bail");
    assert.deepEqual(out.isolation.tools, []);
    assert.equal(out.isolation.denied.length, 1);
  }
  // budget-exhausted
  {
    const client = toolAttemptingClient([
      { reaction: "1", decision: "spokeA" },
      { reaction: "2", decision: "hub" },
      { reaction: "3", decision: "spokeA" },
    ]);
    const out = await runJunctionLoop(hubGraph(), READER, { spawnStrategy: "persistent", client, patienceBudget: 2 });
    assert.equal(out.stopReason, "budget-exhausted");
    assert.deepEqual(out.isolation.tools, []);
    assert.ok(out.isolation.denied.length >= 1);
  }
  // terminal
  {
    const client = toolAttemptingClient([
      { reaction: "hooked", decision: "intro" },
      { reaction: "still reading", decision: "body" },
    ]);
    const out = await runJunctionLoop(chainGraph(), READER, { spawnStrategy: "persistent", client });
    assert.equal(out.stopReason, "terminal");
    assert.deepEqual(out.isolation.tools, []);
    assert.ok(out.isolation.denied.length >= 1);
  }
  // invalid-decision
  {
    const client = toolAttemptingClient([{ reaction: "go", decision: "no-such-junction" }]);
    const out = await runJunctionLoop(hubGraph(), READER, { spawnStrategy: "persistent", client });
    assert.equal(out.stopReason, "invalid-decision");
    assert.deepEqual(out.isolation.tools, []);
    assert.equal(out.isolation.denied.length, 1);
  }
});
