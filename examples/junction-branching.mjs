// examples/junction-branching.mjs — a worked BRANCHING (hub-and-spoke) junction
// example (panelist#48, slice 3). Structurally identical in SHAPE to jauss's real
// book-navigation graph (cover -> foreword/preface -> an index hub with a back-edge
// -> leaf "method" junctions), but with generic placeholder content — jauss's actual
// book text stays in cwc. Copy this shape; swap in your own content + verdict hook.
//
// Everything here uses ONLY panelist's public API (runJunctionLoop + the slice-2
// schema). In-repo we import from ../src/index.mjs; a downstream consumer writes:
//   import { runJunctionLoop, ENGAGEMENT } from "panelist";

import { fileURLToPath } from "node:url";
import { runJunctionLoop, ENGAGEMENT } from "../src/index.mjs";

/**
 * A minimal book-navigation graph. `cover` branches to a foreword or a preface;
 * both funnel into an `index` HUB; the hub offers three leaf "method" junctions,
 * each of which links BACK to the hub (the back-edge). This is the hub-and-spoke
 * shape with revisits — the same shape jauss walks over a real book.
 *
 * A consumer supplies THREE things (and nothing else): each junction's `content`,
 * the `decisions(state)` available from it, and — optionally — a per-junction
 * `cost` and a `patience(horizon)` seed. The engine supplies the barrier, the
 * always-available bail, and the patience gate.
 */
export function bookGraph() {
  const backToIndex = () => [{ id: "index", label: "Back to the index" }];
  return {
    entry: "cover",
    // A patient book reader: seed patience from the horizon (unknown -> a generous 8).
    patience: (horizon) => (horizon === "skim" ? 3 : 8),
    junctions: {
      cover: {
        content: "COVER — “Shipping, Briefly”. A short book about getting things out the door.",
        decisions: () => [
          { id: "foreword", label: "Read the foreword" },
          { id: "preface", label: "Read the author's preface" },
        ],
      },
      foreword: {
        content: "FOREWORD — a colleague vouches for the author and the method.",
        decisions: () => [{ id: "index", label: "Skip ahead to the index" }],
      },
      preface: {
        content: "PREFACE — the author explains why the book is deliberately short.",
        decisions: () => [{ id: "index", label: "On to the index" }],
      },
      index: {
        content: "INDEX — the hub. Pick a method chapter to read.",
        decisions: () => [
          { id: "methodScope", label: "Method: cut the scope" },
          { id: "methodShip", label: "Method: ship the ugly first slice" },
          { id: "methodMeasure", label: "Method: measure the drop-off" },
        ],
      },
      methodScope: { content: "METHOD (scope) — how to halve the plan.", decisions: backToIndex },
      methodShip: { content: "METHOD (ship) — how to release the embarrassing v0.", decisions: backToIndex },
      methodMeasure: { content: "METHOD (measure) — how to see where readers quit.", decisions: backToIndex },
    },
  };
}

/**
 * A toy consumer verdict hook: a simple pass/fail "gate". Reads ONLY the generic
 * trace (never a jauss-specific field) — the interpretation lives entirely here,
 * outside the engine. Passes if the reader actually KEPT at least two method
 * chapters (engaged with them, not merely skimmed or bailed).
 *
 * @param {{junctionTrace: {junction:string, engagement:string}[], dropOff:object}} trace
 */
export function bookGateVerdict(trace) {
  const methodsKept = trace.junctionTrace.filter(
    (r) => r.junction.startsWith("method") && r.engagement === ENGAGEMENT.KEPT,
  ).length;
  return { pass: methodsKept >= 2, methodsKept };
}

// A scripted stand-in for a real persona client. In PRODUCTION you inject a real
// adapter ({ model, complete }) — a PromptFoo/LiteLLM client — exactly as spawn.mjs
// does; no live provider is bundled. Here we script a reader who reads the foreword,
// keeps two methods, then bails, so the example runs deterministically offline.
const DEMO_WALK = [
  { reaction: "decent cover, I'll start at the foreword", engagement: "kept", decision: "foreword" },
  { reaction: "fine, get me to the index", engagement: "kept", decision: "index" },
  { reaction: "scope-cutting first", engagement: "kept", decision: "methodScope" },
  { reaction: "useful — back for another", engagement: "kept", decision: "index" },
  { reaction: "now the shipping one", engagement: "kept", decision: "methodShip" },
  { reaction: "also useful — back to the hub", engagement: "kept", decision: "index" },
  { reaction: "two solid methods, I'm satisfied", engagement: "bailed", decision: "bail" },
];

export function demoClient(walk = DEMO_WALK) {
  let i = 0;
  return {
    model: "scripted-demo",
    async complete() {
      const r = walk[i] ?? { reaction: "(done)", engagement: "bailed", decision: "bail" };
      i += 1;
      return { ok: true, text: JSON.stringify(r), model: "scripted-demo" };
    },
  };
}

/** Run the branching example end-to-end and attach the gate verdict via onComplete. */
export async function runBookExample(client = demoClient()) {
  const persona = { id: "book-reader", name: "Patient Book Reader", role: "reads short non-fiction end to end", caresAbout: ["a concrete method"] };
  return runJunctionLoop(bookGraph(), persona, { spawnStrategy: "persistent", client, horizon: "evening" }, { onComplete: bookGateVerdict });
}

// `node examples/junction-branching.mjs` prints the trace + verdict.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = await runBookExample();
  console.log("path:", out.path.map((p) => `${p.junctionId}(${p.engagement})`).join(" -> "));
  console.log("dropOff:", out.trace.dropOff);
  console.log("gate verdict:", out.verdict);
}
