import { test } from "node:test";
import assert from "node:assert/strict";
import { TRACE_KEYS } from "../src/lib/junction-schema.mjs";
import { bookGraph, bookGateVerdict, runBookExample, demoClient as bookClient } from "../examples/junction-branching.mjs";
import { blogGraph, readPastVerdict, runBlogExample, demoClient as blogClient } from "../examples/junction-linear-chain.mjs";

// Acceptance criterion: both example graphs run end-to-end against a mock client.

test("branching (book) example runs end to end and the toy gate passes on a 2-method reader", async () => {
  const out = await runBookExample(bookClient());
  // Hub-and-spoke with revisits: the index hub is visited three times via the back-edge.
  assert.equal(out.path.filter((p) => p.junctionId === "index").length, 3);
  assert.deepEqual(out.trace.dropOff, { stoppedAt: "index", reason: "persona bailed voluntarily" });
  assert.deepEqual(out.verdict, { pass: true, methodsKept: 2 });
  // The trace handed to the consumer hook is the generic shape, nothing more.
  assert.deepEqual(Object.keys(out.trace).sort(), [...TRACE_KEYS].sort());
});

test("branching example: the barrier holds — an unchosen method's content never leaks into a prompt", async () => {
  // Capture every prompt the loop builds, and script a reader who only ever reads
  // methodScope, never methodMeasure.
  const captured = [];
  const walk = [
    { reaction: "cover", engagement: "kept", decision: "foreword" },
    { reaction: "fwd", engagement: "kept", decision: "index" },
    { reaction: "scope", engagement: "kept", decision: "methodScope" },
    { reaction: "done", engagement: "bailed", decision: "bail" },
  ];
  let i = 0;
  const spyClient = {
    model: "spy",
    async complete({ prompt }) {
      captured.push(prompt);
      const r = walk[i] ?? { reaction: "(done)", engagement: "bailed", decision: "bail" };
      i += 1;
      return { ok: true, text: JSON.stringify(r), model: "spy" };
    },
  };
  await runBookExample(spyClient);
  assert.ok(captured.some((p) => p.includes("METHOD (scope)")), "chosen method content WAS shown");
  for (const p of captured) {
    assert.ok(!p.includes("METHOD (measure)"), "unchosen method content leaked into a prompt");
  }
});

test("linear-chain (blog) example runs end to end and tallies read-past depth", async () => {
  const out = await runBlogExample(blogClient());
  // The scripted reader quits after body1 — engaged headline + hook, bailed at body1.
  assert.deepEqual(out.verdict, { junctionsRead: ["headline", "hook"], readDepth: 2, reachedEnd: false });
  assert.equal(out.trace.dropOff.stoppedAt, "body1");
});

test("linear-chain example: a reader who goes the distance reaches the terminal 'finished'", async () => {
  // Same graph, a more patient reader who reads to the end.
  const walk = [
    { reaction: "biting", engagement: "kept", decision: "hook" },
    { reaction: "promise clear", engagement: "kept", decision: "body1" },
    { reaction: "cut 1 good", engagement: "kept", decision: "body2" },
    { reaction: "finished it", engagement: "kept", decision: "bail" }, // body2 is terminal; decision ignored for nav
  ];
  const out = await runBlogExample(blogClient(walk));
  assert.equal(out.trace.dropOff.stoppedAt, "finished");
  assert.equal(out.verdict.reachedEnd, true);
  assert.deepEqual(out.verdict.junctionsRead, ["headline", "hook", "body1", "body2"]);
});

test("both example graphs are valid inputs to the engine (public API only, no API change needed)", () => {
  for (const graph of [bookGraph(), blogGraph()]) {
    assert.ok(graph.entry in graph.junctions);
    for (const [id, j] of Object.entries(graph.junctions)) {
      assert.equal(typeof j.content, "string", `${id} content`);
      assert.equal(typeof j.decisions, "function", `${id} decisions`);
    }
  }
  // The verdict hooks read only generic trace fields (they run against a hand-built trace).
  const trace = { entryJunction: "x", junctionTrace: [{ junction: "methodScope", engagement: "kept", decision: "index", reactionText: "" }], dropOff: { stoppedAt: "finished", reason: "" } };
  assert.deepEqual(bookGateVerdict(trace), { pass: false, methodsKept: 1 });
  assert.equal(readPastVerdict(trace).readDepth, 1);
});
