// examples/junction-linear-chain.mjs — a worked LINEAR-CHAIN junction example
// (panelist#48, slice 3). This is the shape a blog-engagement judge walks:
// headline -> hook -> body1 -> body2, asking "want to read more?" at each reveal.
// The SAME engine that walks jauss's branching book graph walks this straight line —
// a chain is just a graph where every junction offers exactly one forward decision,
// and the last offers none (a terminal junction ends the run naturally).
//
// Public API only. In-repo we import from ../src/index.mjs; downstream:
//   import { runJunctionLoop, ENGAGEMENT } from "panelist";

import { fileURLToPath } from "node:url";
import { runJunctionLoop, ENGAGEMENT } from "../src/index.mjs";

/**
 * A four-link chain. Each junction reveals one more slice of the post and offers a
 * single "keep reading" decision; `body2` is TERMINAL (no forward decisions), so
 * reaching it ends the run as "finished" with no special-casing. Bail is always
 * available, so the reader can quit at any reveal — that IS the engagement signal.
 */
export function blogGraph() {
  return {
    entry: "headline",
    junctions: {
      headline: { content: "HEADLINE — “Why your standups are 20 minutes too long”.", decisions: () => [{ id: "hook", label: "Read the opening" }] },
      hook: { content: "HOOK — a one-line promise: three cuts, no new tools.", decisions: () => [{ id: "body1", label: "Keep reading" }] },
      body1: { content: "BODY 1 — cut #1: no laptops.", decisions: () => [{ id: "body2", label: "Keep reading" }] },
      body2: { content: "BODY 2 — cuts #2 and #3, then a one-line wrap.", decisions: () => [] }, // terminal
    },
  };
}

/**
 * A toy consumer verdict hook tallying "read past junction N" — the engagement
 * verdict a blog judge wants. Reads ONLY the generic trace. A junction counts as
 * ENGAGED when the reader did not bail on it (kept OR skimmed); `readDepth` is how
 * far down the chain they got before quitting. The signal is `engagement`, not the
 * decision — at the TERMINAL junction the decision is ignored (there is nowhere to
 * go), so a decision-based tally would wrongly drop a fully-read final junction.
 *
 * @param {{junctionTrace:{junction:string,engagement:string}[], dropOff:object}} trace
 */
export function readPastVerdict(trace) {
  const junctionsRead = trace.junctionTrace.filter((r) => r.engagement !== ENGAGEMENT.BAILED).map((r) => r.junction);
  return {
    junctionsRead,
    readDepth: junctionsRead.length, // how far down the chain the reader got before quitting
    reachedEnd: trace.dropOff.stoppedAt === "finished",
  };
}

// Scripted stand-in for a real injected client (see the branching example's note).
// This reader quits after body1 — a realistic "lost them halfway" engagement trace.
const DEMO_WALK = [
  { reaction: "good headline, I'll bite", engagement: "kept", decision: "hook" },
  { reaction: "ok the promise is clear", engagement: "kept", decision: "body1" },
  { reaction: "cut #1, but I get the gist — I'm out", engagement: "bailed", decision: "bail" },
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

/** Run the linear-chain example end-to-end and attach the read-past tally via onComplete. */
export async function runBlogExample(client = demoClient()) {
  const persona = { id: "web-reader", name: "Impatient Web Reader", role: "skims posts, quits the moment the payoff stalls", caresAbout: ["speed", "a concrete payoff"] };
  return runJunctionLoop(blogGraph(), persona, { spawnStrategy: "respawn", client, horizon: "web" }, { onComplete: readPastVerdict });
}

// `node examples/junction-linear-chain.mjs` prints the trace + verdict.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = await runBlogExample();
  console.log("path:", out.path.map((p) => `${p.junctionId}(${p.engagement})`).join(" -> "));
  console.log("dropOff:", out.trace.dropOff);
  console.log("read-past verdict:", out.verdict);
}
