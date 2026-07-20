# Invocation contract: vote / comment / converse

> **Status: v1 of the contract, as implemented in [`src/lib/spawn.mjs`](../src/lib/spawn.mjs).**
> The honesty caveat this contract inherits (deal-killers first, never a warmth
> score) is governed by
> [`docs/synthetic-persona-best-practices.md`](synthetic-persona-best-practices.md) —
> this doc doesn't re-derive that rule, it just keeps the wrapper shaped so a
> caller can't accidentally drop it.

## Call shape

```js
spawn(personaId, { mode, artifact, instruction, responseSchema, horizon }, deps)
```

- `personaId` — a registered persona identity (see `registerPersonas`).
- `mode` — one of `"vote" | "comment" | "converse"`.
- `artifact` — string or `{ text }`-shaped object under review.
- `instruction` — optional free-text steer ("would you stop reading before the
  install command?").
- `responseSchema` — optional. Its presence, not the mode, is what turns
  `verdict` on.
- `horizon` — optional time-horizon framing passed through to the prompt.
- `deps.client` — injected model adapter (`{ model, complete }`). No live
  provider is bundled; the default throws.

## Response wrapper

Every call, in every mode, returns exactly this shape:

```js
{ personaId, mode, verdict: object | null, message: string, dealKillers: string[] }
```

There is one wrapper, not one-per-mode. `spawn.mjs` builds it the same way
regardless of `mode` — mode only changes the instruction text handed to the
model and whether the prompt asks for a `verdict` field at all.

## Mode semantics

- **`vote`** — render a judgement. If `responseSchema` is supplied, the model
  is asked to fill `verdict` per that schema and put a one-paragraph rationale
  in `message`. If no schema is supplied, `vote` still runs — the persona
  states a judgement in `message`, but `verdict` stays `null` (there's no
  schema to validate it against).
- **`comment`** — single-turn free-text critique. The prompt explicitly tells
  the model "do not vote; just react." `verdict` is always `null` in this
  mode, schema or not.
- **`converse`** — one conversational turn: the persona responds to the
  artifact/instruction in its own voice. `verdict` is always `null`.

**Current-slice note:** in this single-turn contract, `comment` and
`converse` both resolve to exactly one model call with a different
instruction string — there is no dialogue state, no tool use, and no
follow-up turn. A persistent, multi-turn/agentic converse plane (subagents,
tool use, actual back-and-forth) is a **later slice (panelist#4)**, not
something this contract already does under a friendlier name.

## Two execution planes

panelist ships two ways to invoke a persona, and both consume the **same
persona identity** (the register record: `caresAbout` / `rewards` / `punishes`
/ `quitsWhen`) and, for `spawn`, the **same wrapper contract** described here:

| Plane | Entry point | Shape | Use for |
|---|---|---|---|
| **Programmatic** | `score.mjs` (`score` / `scoreCandidate`) | High fan-out: every persona × every panelist in a cross-model panel, aggregated into axis scores and a keep/cut verdict | Ranking or gating many candidates against a fixed rubric — "score these 20 drafts, cut the bottom half" |
| **Agentic** | `spawn.mjs` (`spawn`) | One persona, one turn, one wrapper | Ad hoc single-persona invocation at a call site — "would *this* persona stop reading here?" |

`score.mjs` is rubric-shaped: it takes a `rubric` (axes, kill axes, kill
floor, cut threshold), runs the full persona × panelist matrix through
`createLimiter`-bounded concurrency, and returns
`{ scores, aggregate, verdict, crossModel, panelistsFailed }` — built for
volume and the cross-model anti-sycophancy guarantee
(`crossModel: spansMultipleProviders(...)`), not for talking to one persona.

`spawn.mjs` is call-shaped: one `personaId`, one `{ mode, artifact, ... }`,
one wrapper. Today that's a single model call; it's the foundation the
richer agentic converse plane (panelist#4) builds on without changing this
contract.

Use `score` for a rubric-driven verdict across a panel. Use `spawn` for one
persona's reaction, vote, or comment on demand.

## Verdict schema (Decision D3 — resolved)

**Decision:** `verdict` is an **open object, validated per the
`responseSchema` the caller supplies** — the wrapper does not prescribe a
fixed verdict shape. A social-media persona's schema might carry numeric axes
(`resonance`, `clarity`, ...); a blog gate might carry a red/yellow/green
enum; a Jauss-style acceptance gate might carry a single boolean pass/fail.
None of these need their own wrapper variant. `dealKillers[]` is always
present alongside `verdict` regardless of which schema is in play — objection
surfacing isn't part of the verdict shape, it's part of the wrapper.

**Why this is the right call (not a fixed union type):** a fixed
`verdict: NumericAxes | TrafficLight | Gate` union would force every new
caller to extend a central type before invoking a persona with a new kind of
judgement, coupling unrelated call sites through one enum. An open
`verdict` validated against the caller's own `responseSchema` keeps `spawn`'s
wrapper permanently stable — a new verdict shape next year is a caller-side
change, not a contract change. `verdict`'s internals aren't type-checked by
this module; validating "does this JSON match my schema" is the caller's
job, not the invocation contract's.

## Worked examples

### `vote`, with a schema (verdict filled)

```js
const result = await spawn(
  "drive-by-installer",
  {
    mode: "vote",
    artifact: readmeText,
    instruction: "Would you stop reading before you found the install command?",
    responseSchema: { pass: "boolean", frictionPoint: "string" },
  },
  { client },
);
```

```json
{
  "personaId": "drive-by-installer",
  "mode": "vote",
  "verdict": { "pass": false, "frictionPoint": "install command buried after three paragraphs of philosophy" },
  "message": "I bounce before I ever see `npm install`. Three paragraphs of mission statement before the how-to.",
  "dealKillers": ["no install command above the fold"]
}
```

### `comment`, no verdict

```js
const result = await spawn(
  "production-evaluator",
  { mode: "comment", artifact: readmeText },
  { client },
);
```

```json
{
  "personaId": "production-evaluator",
  "mode": "comment",
  "verdict": null,
  "message": "No mention of test coverage or a stability guarantee — I can't tell if this is safe to depend on in prod.",
  "dealKillers": []
}
```

### `converse`, one turn

```js
const result = await spawn(
  "maintainers-maintainer",
  { mode: "converse", artifact: prSummary, instruction: "React to this PR description." },
  { client },
);
```

```json
{
  "personaId": "maintainers-maintainer",
  "mode": "converse",
  "verdict": null,
  "message": "Fine change, but the PR body doesn't say which issue this closes — I'd ask for that before reviewing further.",
  "dealKillers": ["no linked issue"]
}
```

## Invariants

- `message` is **always** free text, in the persona's own voice — every mode,
  schema or not.
- `verdict` is non-`null` **iff** `responseSchema` was supplied to `spawn`.
  Mode alone never turns it on — `vote` without a schema still returns
  `verdict: null`.
- `dealKillers` is **always** an array (possibly empty), in every mode. A
  persona may surface a blocking objection whether it's voting, commenting,
  or conversing.
- The wrapper shape (`personaId`, `mode`, `verdict`, `message`, `dealKillers`)
  never changes across modes or across whether a schema was supplied — only
  the values inside it do.

## Forward-compat

Two later slices build on this contract without changing the wrapper shape:

- **panelist#4 — agentic converse plane.** `converse` (and possibly `comment`)
  grows from one model call into a real multi-turn dialogue with subagents
  and tool use. The wrapper stays
  `{ personaId, mode, verdict, message, dealKillers }` — what changes is how
  many model calls produce that final `message`, not the shape returned.
- **panelist#6 — honesty-guardrail auto-stamp.** Per
  `synthetic-persona-best-practices.md` §6, every panel output should
  auto-stamp the "this is not user research" caveat by construction. Today
  that discipline lives in the surrounding docs/README, not the wrapper
  itself. panelist#6 is expected to add the stamp as a field on this same
  wrapper — additive, not a breaking reshape of `spawn`'s contract.
