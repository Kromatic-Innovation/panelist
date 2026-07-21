# Junction contract: multi-turn information-barrier walks

> **Status: slices 1–3 implemented.** The engine is [`src/lib/junction.mjs`](../src/lib/junction.mjs)
> (the graph + loop runner) and [`src/lib/junction-schema.mjs`](../src/lib/junction-schema.mjs)
> (the generic reaction/trace schema). The two worked examples this doc walks
> through are runnable:
> [`examples/junction-branching.mjs`](../examples/junction-branching.mjs) and
> [`examples/junction-linear-chain.mjs`](../examples/junction-linear-chain.mjs).

The junction engine reveals a graph **one junction at a time**, letting a persona
decide what to look at next and never showing it content it didn't choose. It is
the generic engine underneath two different consumers:

- a **branching** hub-and-spoke walk (a persona navigating a book — jauss), and
- a **linear chain** (a reader deciding, at each reveal of a blog post, whether they
  "want to read more?").

Both are the same core move — *reveal one junction, let the reader choose, never
leak an unchosen junction* — so panelist ships **one** engine and hands it two
different graphs. This doc shows how to author a graph, what the engine guarantees,
and what a consumer must supply.

## The split: engine emits mechanics, consumers own interpretation

This is the whole design, and it mirrors [`spawn.mjs`](../src/lib/spawn.mjs)'s
`mode` separation of the generic wrapper from mode-specific text:

- The **engine** emits **mechanics**: which junction the reader stood on each turn,
  how it engaged (`kept` / `skimmed` / `bailed`), what it chose next, and where the
  walk stopped. It bundles **no** interpretation — no gate verdicts, no deal-killer
  severities, no continue/stop tallies, no scores or stars.
- The **consumer** attaches **all** interpretation on top, via a verdict hook. jauss
  computes Gate 1 / Gate 2 from the same trace a blog judge uses to compute a
  continue/stop tally. Neither interpretation leaks into the trace.

If you find yourself wanting a consumer-specific field *in the trace*, it belongs in
your verdict hook instead.

## Authoring a graph

A graph is a plain object. A consumer supplies exactly three things per junction —
`content`, the `decisions` available from it, and (optionally) a `cost`:

```js
{
  entry: "cover",                       // id of the starting junction
  patience: (horizon) => 8,             // optional: seed the patience budget from the horizon
  junctions: {
    cover: {
      content: "COVER — a short book about shipping.",  // string, OR (state) => string (resolved lazily)
      decisions: () => [                                // (state) => [{ id, label }]; id is the TARGET junction
        { id: "foreword", label: "Read the foreword" },
        { id: "preface",  label: "Read the preface" },
      ],
      cost: 1,                                          // optional: patience this junction burns (default 1)
    },
    // ...
  },
}
```

- **`content`** may be a string or a `(state) => string` function — resolved
  **lazily**, only for the junction the reader is standing on. This is what makes the
  barrier structural (below).
- **`decisions(state)`** returns the forward moves. Each `id` is the id of the target
  junction. A junction that returns `[]` is **terminal** — reaching it ends the walk
  naturally.
- **Bail is added for you.** Every junction implicitly offers a `bail` decision; you
  never author it (and a graph may not name a junction `"bail"`).

### The two shapes, side by side

A **branching** graph (see `examples/junction-branching.mjs`): `cover` →
`foreword`/`preface` → an `index` hub → leaf `method*` junctions, each linking **back**
to the hub. Hub-and-spoke with revisits — jauss's real shape.

A **linear chain** (see `examples/junction-linear-chain.mjs`): `headline` → `hook` →
`body1` → `body2`, where every junction offers exactly one forward decision and the
last offers none. A chain is just a graph; no special engine mode is needed.

## What the engine guarantees

1. **The structural information barrier.** The runner only ever touches
   `graph.junctions[current]` — the junction the reader is standing on — and resolves
   *that* junction's content lazily. It never iterates all junctions, never
   pre-assembles the graph into one prompt, and never reads an unchosen junction's
   content. So an unchosen junction's content **cannot** leak into any prompt: there
   is no code path that reads it. (The branching example's test asserts this directly
   — an unchosen `method` chapter's body never appears in a captured prompt.)
2. **Bail is always available, from every junction.** The reader can quit anywhere;
   quitting ends the run cleanly as `stopReason: "bail"`.
3. **A finite patience budget guarantees termination.** Each engaged junction burns
   its `cost` (default 1) from a patience budget seeded by `opts.patienceBudget`, then
   `graph.patience(horizon)`, then a finite default. Even a cyclic graph with a reader
   who never bails terminates as `stopReason: "budget-exhausted"`.

## What a consumer supplies

1. **The graph content** — junction text and the decision menus (above).
2. **A model client** — the same injected `{ model, complete }` adapter `spawn.mjs`
   uses. **No live provider is bundled**; pass a mock in tests, or a PromptFoo/LiteLLM
   adapter in production. (The examples script a deterministic stand-in so they run
   offline.)
3. **A verdict hook** (optional) — `runJunctionLoop(graph, persona, opts, { onComplete })`.
   The engine invokes `onComplete(trace)` once the walk ends and surfaces its return
   value as `result.verdict`. This is where **all** interpretation lives.

### The generic trace your hook receives

```js
{
  entryJunction: "cover",
  junctionTrace: [
    { junction: "cover", engagement: "kept", decision: "foreword", reactionText: "..." },
    // ...one per turn
  ],
  dropOff: { stoppedAt: "index" /* or "finished" */, reason: "persona bailed voluntarily" },
}
```

`engagement` is the generic 3-state `kept` | `skimmed` | `bailed`. A linear-chain
consumer can use only `kept`/`bailed` and ignore `skimmed` — same shape, no change.
`dropOff.stoppedAt` is `"finished"` when the walk reached a terminal junction, else
the id of the junction the reader was standing on when it stopped.

### Two verdict hooks over the SAME trace

A jauss-shaped **gate** (from the branching example):

```js
function bookGateVerdict(trace) {
  const methodsKept = trace.junctionTrace.filter(
    (r) => r.junction.startsWith("method") && r.engagement === "kept",
  ).length;
  return { pass: methodsKept >= 2, methodsKept };  // interpretation lives HERE, not in the engine
}
```

A blog-shaped **read-past tally** (from the linear-chain example):

```js
function readPastVerdict(trace) {
  const junctionsRead = trace.junctionTrace.filter((r) => r.engagement !== "bailed").map((r) => r.junction);
  return { junctionsRead, readDepth: junctionsRead.length, reachedEnd: trace.dropOff.stoppedAt === "finished" };
}
```

Same generic trace, two entirely different interpretations — computed outside the
engine.

## Aggregating across many runs

`aggregateJunctionTraces(traces[])` rolls up a stratified batch into a **drop-off
histogram** and **per-junction engagement counts**. By design it **never** collapses
dispersion into a single scalar (no score, star, mean, or pass-rate) — consistent
with the synthetic-persona rule to
[preserve dispersion](synthetic-persona-best-practices.md) rather than average into
one happy number. A consumer that wants a headline number computes it itself and owns
that reductive choice.

## Running the examples

```sh
node examples/junction-branching.mjs      # branching hub-and-spoke walk + a pass/fail gate
node examples/junction-linear-chain.mjs   # linear chain + a read-past tally
```

Both run offline against a scripted stand-in client and print the path, the drop-off,
and the consumer verdict. Copy either module's shape, swap in your own content,
decisions, and verdict hook, and inject a real client.
