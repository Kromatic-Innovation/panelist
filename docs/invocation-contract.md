# Invocation contract: vote / comment / converse

> **Status: v1 of the contract, as implemented in [`src/lib/spawn.mjs`](../src/lib/spawn.mjs).**
> The honesty caveat this contract inherits (deal-killers first, never a warmth
> score) is governed by
> [`docs/synthetic-persona-best-practices.md`](synthetic-persona-best-practices.md) —
> this doc doesn't re-derive that rule, it just keeps the wrapper shaped so a
> caller can't accidentally drop it.

## Call shape

```js
spawn(
  personaId,
  { mode, artifact, instruction, responseSchema, horizon, tools, model },
  deps,
);
```

- `personaId` — a registered persona identity (see `registerPersonas`).
- `mode` — one of `"vote" | "comment" | "converse"`.
- `artifact` — string or `{ text }`-shaped object under review.
- `instruction` — optional free-text steer ("would you stop reading before the
  install command?").
- `responseSchema` — optional. Its presence, not the mode, is what turns
  `verdict` on.
- `horizon` — optional time-horizon framing passed through to the prompt.
- `tools` — optional explicit tool allowlist (panelist#72). **Omit for full
  isolation** — `spawn` grants no tools by default. See
  ["Tool isolation"](#tool-isolation-panelist72) below.
- `model` — optional per-call model tier (panelist#113). **Omit to inherit** the
  caller's model — the `model` string is forwarded opaquely to
  `deps.client.complete(...)` only when supplied; when omitted, the `model` key
  is left off the `complete` call entirely, so `deps.client`'s own `model`
  (its adapter default) is used and no existing caller changes behavior. Like
  `tools`, `model` is **execution-shaping, not prompt-shaping** — it never
  changes the rendered prompt. panelist expresses **no policy** about which tier
  any lane should use and does not validate the string against a provider
  catalog; that is the consumer's decision. This is the per-call sibling of
  `deps.client`'s adapter-level `model`, which remains the default when no
  per-call `model` is given.

### Model tier resolution (panelist#119, companion to cwc#1879)

A persona record may also carry an optional `modelTier` — a register-carried
**default** model tier, so a consumer can declare "this panel runs at
`sonnet`" once on the persona instead of passing `model` at every call site.
It's the same kind of opaque, unvalidated string as `model` above (panelist
does not check it against a provider catalog), and it is **execution-shaping,
not prompt-shaping** — `renderRunnerPrompt`/`buildSpawnPrompt` never read it,
so the rendered prompt is byte-identical with or without it.

Resolution order, most specific wins:

1. `opts.model` (explicit per-call, panelist#113) — always wins when given.
2. `persona.modelTier` (register-carried default) — used when `opts.model` is
   omitted.
3. Neither set — the `model` key is left off the `complete()` call entirely,
   same as today: `deps.client`'s own default model is used.

```js
registerPersonas([
  { id: "reviewer", name: "Reviewer", role: "...", caresAbout: [...], rewards: [...], punishes: [...], quitsWhen: [...], modelTier: "sonnet" },
]);

await spawn("reviewer", { mode: "comment", artifact }, { client });
// -> client.complete({ ..., model: "sonnet" })  (persona.modelTier used)

await spawn("reviewer", { mode: "comment", artifact, model: "claude-haiku-4-5" }, { client });
// -> client.complete({ ..., model: "claude-haiku-4-5" })  (opts.model wins)
```

A `registerPersonas` object source (`{ personas, rubrics?, usage?, modelTier?
}`) may also carry a top-level `modelTier`, which becomes the default for
every record from that source that doesn't already set its own — see
[`src/lib/register.mjs`](../src/lib/register.mjs). A per-record `modelTier`
always overrides the source-level one.
- `deps.client` — injected model adapter (`{ model, complete }`). No live
  provider is bundled; the default throws.
- `deps.toolGate` — optional: share one `isolation.mjs` `createToolGate()`
  gate (and its denied log) across several `spawn` calls in one panel, instead
  of each call building its own from `opts.tools`.

## Response wrapper

Every call, in every mode, returns exactly this shape:

```js
{ personaId, mode, verdict: object | null, message: string, dealKillers: string[], isolation: { tools: string[], denied: object[] }, honesty: string }
```

There is one wrapper, not one-per-mode. `spawn.mjs` builds it the same way
regardless of `mode` — mode only changes the instruction text handed to the
model and whether the prompt asks for a `verdict` field at all.

## Tool isolation (panelist#72)

A persona's isolation from ambient tools (an MCP memory server, web search,
filesystem search) is governed by a deny-by-default allowlist that panelist resolves, forwards
to the injected adapter, and reports. **The adapter is responsible for
enforcing the forwarded allowlist** (refusing or not exposing any tool it
does not name); panelist bundles no provider layer and cannot itself stop an
adapter from reaching a tool:

- **Deny by default.** `spawn`/`runPersona` grant **no tools** unless
  `opts.tools` names them explicitly, e.g. `{ tools: ["web"] }`.
- **No wildcards.** `opts.tools: "*"` (or `true`, or `"all"`/`"any"`) throws
  rather than silently granting everything. This is what keeps isolation
  **closed under discovery**: a tool-discovery/tool-search capability is
  itself a tool, and can only be granted by naming it explicitly like any
  other — never bundled in via a wildcard.
- **The effective set is always reported.** `isolation.tools` in the returned
  envelope is the exact granted allowlist (`[]` means no tool was granted; whether the persona was actually isolated depends on the adapter enforcing it).
- **Denied attempts are reported, not swallowed.** If the injected adapter
  consults the gate (`deps.toolGate`, or the one `spawn` builds internally)
  before dispatching a tool call, or self-reports via
  `res.deniedToolCalls`, every attempted-but-denied call shows up in
  `isolation.denied` as `{ tool, reviewer, at }`.
- **Assembling a panel.** `isolation.mjs`'s `unionTools([...results])`
  accumulates the granted sets from several `spawn` calls into the
  panel-level `isolation.tools`; each per-call result still carries its own
  `isolation.tools`. Read that top-level value as the **effective set**
  applied uniformly across reviewers — *not* as a union across differentiated
  per-reviewer allowlists. The allowlist is panel-wide: it comes from
  `opts.tools` alone, and the reviewer identifier is used only to attribute
  denials, so two reviewers under one config always resolve to identical
  allowlists. Accumulating across calls still matters because a provider may
  grant a different set per call, and the effective set is what the verdict
  was produced under.

See [`src/lib/isolation.mjs`](../src/lib/isolation.mjs) for the deny/allow
decision as an independently testable unit.

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

## Execution planes

panelist ships three ways to invoke a persona — `score`, `spawn`, and the
multi-turn `runJunctionLoop` (see ["Forward-compat"](#forward-compat)) — and
all consume the **same persona identity** (the register record: `caresAbout`
/ `rewards` / `punishes` / `quitsWhen`) and, for `spawn`, the **same wrapper
contract** described here:

| Plane            | Entry point                              | Shape                                                                                                                   | Use for                                                                                                 |
| ---------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Programmatic** | `score.mjs` (`score` / `scoreCandidate`) | High fan-out: every persona × every panelist in a cross-model panel, aggregated into axis scores and a keep/cut verdict | Ranking or gating many candidates against a fixed rubric — "score these 20 drafts, cut the bottom half" |
| **Agentic, single-turn** | `spawn.mjs` (`spawn`)            | One persona, one turn, one wrapper                                                                                      | Ad hoc single-persona invocation at a call site — "would _this_ persona stop reading here?"             |
| **Agentic, multi-turn** | `junction.mjs` (`runJunctionLoop`) | A persona walks a decision graph one junction at a time, behind a structural information barrier                      | Sequential drop-off — "will you read the next one?" for books, posts, and flows                         |

`score.mjs` is rubric-shaped: it takes a `rubric` (axes, kill axes, kill
floor, cut threshold, quorum), runs the full persona × panelist matrix through
`createLimiter`-bounded concurrency, and returns

```
{ candidate, scores, aggregate, verdict, verdictReason, personasMissing,
  complete, incompleteReason, attempts, quorum, crossModel, panelistsFailed, panelSize, panelistsReported,
  failuresByCause, honesty, isolation }
```

— built for volume and the cross-model anti-sycophancy guarantee
(`crossModel: spansMultipleProviders(...)`), not for talking to one persona.

`quorum` is the panel-attrition envelope behind `verdict`:
`{ required, reported, panelSize, fraction, met }`, plus a `note` **only**
when `met` is `false`. When fewer than `required` panelists report, `verdict`
is *pinned* to `"cut"` rather than derived from the survivors — the survivors'
scores and `aggregate` are still reported for human context, and only the
machine-readable verdict fails closed. The built-in total-panel-failure
fallback returns the same keys plus `fallback: true`. On a *total* panel
failure (zero panelists reported at all), `verdict` is library-pinned to
`"cut"` even when a caller replaces the fallback via `deps.fallback` — a
custom fallback cannot raise it back to `"keep"`, return an off-vocabulary
value, or omit it and have that silently pass through (panelist#176). Every
other key — `scores`, `aggregate`, `note`, `fallback`, and any caller-added
key — is still whatever the custom fallback emitted, with no obligation to
provide any of them, so guard when reading these off an arbitrary result.

`personasMissing` (panelist#245) is an array of persona ids (the same id form
as `scores.byPersona[].persona`) that have **zero** successful calls — every
panelist call for that persona failed. It is `[]` when every persona reported,
and is present on every result: the live path and both fallback paths. On a
total outage every persona is missing; the library stamps it even when a
custom `deps.fallback` is used. Quorum counts persona × model cells, so a whole
persona can drop out while quorum is still met and a verdict is still derived;
`personasMissing` is how a caller sees that.

`verdictReason` (panelist#245) says why `verdict` is what it is, and is present
on every result. One of: `"score"` (derived by the verdict rules),
`"below-quorum"` (quorum not met, verdict pinned to `"cut"`), `"total-outage"`
(zero panelists reported, fallback path), or `"persona-missing"` (quorum met,
`requireEveryPersona` on, `personasMissing` non-empty, verdict forced to
`"cut"`). Precedence: `total-outage` > `below-quorum` > `persona-missing` >
`score`.

**Retries and completeness (panelist#246).** Before the verdict is derived,
each failed persona × model cell is retried: a transport error, an adapter
`ok: false`, a non-string reply, or an unparsable reply all count. Defaults:
`deps.retries = 2` (up to 3 attempts per cell) and `deps.retryDelayMs = 200`
(exponential: `retryDelayMs * 2^(retry-1)`, i.e. 200 ms then 400 ms). Both are
overridable through `deps`; an invalid value (non-integer or negative
`retries`, non-finite or negative delay) falls back to the default and never
throws. `retries: 0` disables retrying. Every attempt goes through the
concurrency limiter separately and the backoff sleep happens outside it, so
retries never exceed the configured concurrency. **Extra adapter calls:** a
persistently failing cell costs up to `retries + 1` calls (3 by default), so
budget or meter accordingly. `failuresByCause` and `panelistsFailed` count
final failures once per cell, not per attempt. Retrying inside `spawn` or the
junction engine is out of scope.

Every result also carries `complete` (boolean), `incompleteReason` and
`attempts` (total adapter calls made), computed after retries are exhausted.
`incompleteReason` is `"total-outage"` (zero panelists reported),
`"below-quorum"` (quorum not met), `"partial"` (quorum met but some cell
failed or a persona is missing), or `null` when `complete` is `true`. A result
whose verdict came from the outage or quorum fail-closed path therefore has
`incompleteReason` of `"total-outage"` or `"below-quorum"` and is distinguishable
from a score-driven verdict by this field alone. The verdict rules themselves
are unchanged. Consumers should **not** treat a `cut` with `complete: false`
as a judgment on the candidate: keep it for a later retry or for human review.

`spawn.mjs` is call-shaped: one `personaId`, one `{ mode, artifact, ... }`,
one wrapper. Today that's a single model call; it's the foundation the
richer agentic converse plane (panelist#4) builds on without changing this
contract.

Use `score` for a rubric-driven verdict across a panel. Use `spawn` for one
persona's reaction, vote, or comment on demand.

### Rubric reference

Every field below is caller-settable on the `rubric` object passed to `score()`
/ `scoreCandidate()`. The defaults are `normalizeRubric`'s, in
`src/lib/score.mjs`.

| Field           | Accepts                                                                                                     | Default                                                |
| --------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `axes`          | an array of axis names, **or** an object whose keys are axis names and whose values are per-axis descriptions | `["resonance", "clarity", "credibility", "scrollStop"]` |
| `killAxes`      | an array of axis names, each of which must also be in `axes` (otherwise throws)                              | `[]`                                                    |
| `killFloor`     | a finite number                                                                                              | `4.0`                                                   |
| `cut_threshold` | a finite number                                                                                              | `5.0`                                                   |
| `quorum`        | a finite number in `[0, 1]` inclusive                                                                        | `0.5`                                                   |
| `requireEveryPersona` | `true` or `false`; any non-boolean is treated as `false`                                               | `false`                                                 |

**`axes` accepts two shapes, and the object form does double duty.** An array
simply names the axes. An object *also* supplies a description per axis: its
keys become the axes, and the object itself is retained internally as
`axisDescriptions` so the prompt can explain each axis to the panel.
`axisDescriptions` is derived from `axes` — it is not a separate field a caller
sets.

**Normalization falls back rather than throwing — with one exception.** A
value that fails validation is replaced by that field's default rather than
raising. This makes a bad rubric value silent, not loud: `cut_threshold: "7"`
(a string, not a number) scores against `5.0`, and nothing in the result says
so. The exception is `killAxes`: an entry that is not one of the rubric's
`axes` (a typo, or an axis the rubric does not list) makes `normalizeRubric`
— and therefore `score()` — **throw** an error naming the entry and the valid
axes, because a kill axis that matches nothing would silently disable the kill.
Only an explicitly supplied `killAxes` is checked; the default is `[]`.

**The validation is asymmetric, and the asymmetry is deliberate.** `killFloor`
and `cut_threshold` are checked with `Number.isFinite` only — there is **no
range check** — so a `cut_threshold` of `50` (nothing ever passes) or `-3`
(everything does) is accepted exactly as given. `quorum` is the one field that
is additionally range-checked: outside `[0, 1]` it falls back to `0.5`.

`quorum` has a defined meaning at each end of that range. `0` disables the
floor — `required` becomes 1, so a single reporting panelist is enough — and
`1` demands that the whole attempted panel report. In between, the requirement
is strict (`floor(panelSize × quorum) + 1`, clamped to the panel size), which
is why the default `0.5` means a strict majority rather than "at least half".
All three feed the `quorum` envelope described above without changing its
shape.

One thing `quorum: 0` does **not** do is reopen panelist#80: a panel where
*nobody* reports returns from the total-panel-failure branch before the quorum
check is ever reached, so disabling the floor cannot resurrect a verdict
derived from an empty panel.

**`requireEveryPersona` (panelist#245) is opt-in.** By default a persona whose
every call failed is reported in `personasMissing` but the verdict is still
derived from the personas that did report. With `requireEveryPersona: true`, a
quorum-met result with a non-empty `personasMissing` gets verdict `"cut"` and
`verdictReason: "persona-missing"`. A non-boolean value normalizes to `false`
and never throws. The quorum formula itself is unchanged.

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

> The JSON responses below omit `isolation` for brevity — in practice every
> response also carries `"isolation": { "tools": [], "denied": [] }` (or
> whatever was granted/denied). See ["Tool isolation"](#tool-isolation-panelist72) above.

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
  "verdict": {
    "pass": false,
    "frictionPoint": "install command buried after three paragraphs of philosophy"
  },
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
  {
    mode: "converse",
    artifact: prSummary,
    instruction: "React to this PR description.",
  },
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
- The wrapper shape (`personaId`, `mode`, `verdict`, `message`, `dealKillers`,
  `isolation`) never changes across modes or across whether a schema was
  supplied — only the values inside it do.
- `isolation.tools` is **always** the exact effective allowlist (`[]` by
  default); `isolation.denied` is **always** an array (possibly empty) of
  attempted-but-denied tool calls. See ["Tool isolation"](#tool-isolation-panelist72).

## Forward-compat

- **Multi-turn dialogue and tool use — shipped, not future.** This section
  previously described multi-turn dialogue with subagents and tool use as
  future work gated by isolation (panelist#4). That's stale: `junction.mjs`
  (panelist#46/#47) already shipped a multi-turn model-calling path —
  `runJunctionLoop`, a generic loop-runner that walks a persona through a
  decision graph one junction at a time (see the
  [junction contract](junction-contract.md)) — and panelist#75 gated it with
  the same `isolation` mechanism (panelist#72) `spawn`/`score` use: deny by
  default, `opts.tools`/`opts.toolGate` as the explicit opt-in, wildcards
  throw, and every result carries `isolation: { tools, denied }` on every stop
  path (bail, patience-budget exhaustion, terminal, invalid-decision). `spawn`
  itself remains the single-turn contract this doc describes; `runJunctionLoop`
  is the multi-turn generalization, not a variant of `spawn`'s wrapper — it
  returns its own shape (`{ strategy, path, stopReason, trace, isolation, ... }`),
  not `{ personaId, mode, verdict, message, dealKillers, isolation }`.
- **panelist#6/#81 — honesty-guardrail auto-stamp — shipped.** Per
  `synthetic-persona-best-practices.md` §6, every panel output auto-stamps
  the "this is not user research" caveat by construction. This is no longer
  just surrounding docs/README discipline: `spawn`'s returned wrapper (see
  "Response wrapper" above) now carries a `honesty` field, added via
  `honesty.mjs`'s `stampHonesty` — additive, not a breaking reshape of
  `spawn`'s contract. `runPersona` (`runner.mjs`) delegates to `spawn`
  unmodified, so it inherits the same stamp. The other public output
  surfaces enumerated by panelist#81 (`score`/`rankCandidatesWith`,
  `runJunctionLoop`'s envelope, `aggregateJunctionTraces`,
  `calibratePersonas`) are stamped the same way; `runJunctionLoop`'s nested
  `trace` is deliberately left unstamped since its per-turn shape is locked
  (`REACTION_KEYS`/`TRACE_KEYS`, `junction-schema.mjs`).
