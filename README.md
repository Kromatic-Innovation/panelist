# panelist

[![CI](https://github.com/Kromatic-Innovation/panelist/actions/workflows/ci.yml/badge.svg)](https://github.com/Kromatic-Innovation/panelist/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://github.com/Kromatic-Innovation/panelist/blob/main/LICENSE)
[![npm version](https://img.shields.io/npm/v/panelist)](https://www.npmjs.com/package/panelist)

![panelist: three panelists reading a draft with exit-doors above their heads, a moderator directing the session](docs/assets/hero.png)

**What panelist is:** Synthetic user panels for any artifact, run across multiple model providers to correct for self-preference bias. Most tools of this kind return a warmth score, which invites "the AI loved it" misuse. Panelist models behavior instead: the exact point a persona quits, dismisses, or refuses to click like.

**Differentiator:** panelist's primary output is a **deal-killer / cut-list**: the exact point a persona would quit, dismiss, refuse to click, or refuse to forward — abandonment is behavioral and far more reliably simulable than affect. panelist reports whether a panel spans ≥2 model providers (fighting same-model self-preference bias) via a `crossModel` flag on every result — the caller composes the panel and should check the flag if that property matters, since a single-provider panel still runs to completion. Personas differ by _what makes them quit_ rather than demographics, and every output auto-stamps the honesty caveat that this is a pre-filter, not user research.

**Why:** a 9/10 score from a model that wants to please you is worthless as a filter. A specific point where three independent, cross-model personas all disengage is an actionable signal — that's the difference panelist is built around.

> ⚠️ **What panelist is and is not for.** A synthetic persona is a _model_ of a customer, and your model of the customer is wrong — that is why you talk to real people. panelist is legitimate as a **drafting aid**, a **cheap pre-filter** to kill obviously-weak drafts before spending a human's attention, and a way to catch obvious misses. It is **not** evidence about real readers, **not** a substitute for talking to them, and **not** validation. "Our personas responded well to this" is a sentence this tool is designed to make hard to write.

> **Persona isolation, by construction (panelist#72/#75).** "A persona sees the artifact and nothing else" is a structural claim, not an aspiration: every execution plane — `spawn`/`runPersona`, `score`/`scoreCandidate`, and the multi-turn `runJunctionLoop` — grants a persona **no tools** by default: no MCP server, no web search, no filesystem search. Wildcard/"grant everything" opt-ins are rejected outright, so a tool-discovery capability can never be smuggled in by granting some other tool. Every response reports the effective granted set (`isolation.tools`) and any attempted-but-denied call (`isolation.denied`), so a contaminated run is visible instead of indistinguishable from a clean one. See ["Tool isolation"](docs/invocation-contract.md#tool-isolation-panelist72).

## Why it's different

Most tools that spawn personas emit a warmth/viability _score_ — the exact output that invites "look, the AI loves it" misuse. panelist's primary output is a **deal-killer / cut-list**: _where would this persona stop, dismiss, or refuse to click, forward, or buy?_ Abandonment is behavioural and far more robustly simulable than affect.

- **Deal-killers, not scores.** The default verdict is a cut-list, not a rating.
- **Cross-model panels, reported not enforced.** panelist bundles no provider layer (you inject one, e.g. PromptFoo/LiteLLM — see [Install](#install)), so it can't compose a cross-model panel for you or refuse to run a single-provider one. Every result carries `crossModel: boolean` (`true` when the panel you composed spans ≥2 providers) so you can check it yourself; a single-provider panel still runs to completion and returns `crossModel: false`. Spanning ≥2 providers is recommended to counter same-model self-preference / sycophancy bias — the caller is responsible for composing the panel that way.
- **Diversity by kill-condition.** Personas differ by _what makes them quit_, not by demographics. Identity is behavioural (`rewards` / `punishes` / `quitsWhen`), never age/employer/tenure.
- **Honesty by construction.** Every panel output auto-stamps the caveat above.
- **Isolated by construction.** No tool is reachable unless explicitly granted — see above.
- **Calibration hooks.** Join synthetic verdicts to real downstream signal and rank personas by how well they _predict_, not how well they _read_.

See [`docs/synthetic-persona-best-practices.md`](docs/synthetic-persona-best-practices.md) for the governing rules behind these design choices (specificity over decoration, demographics vs. behaviour, anti-sycophancy, panel diversity, calibration, and the honesty line).

## Install

```bash
npm i panelist
```

panelist is published to the public npm registry as the unscoped package
`panelist` (via OIDC Trusted Publishing — no token needed): owned by Kromatic
Innovation; published to npm from the `trikro` account. No `.npmrc` changes
required.

If you land on a `@kromatic-innovation/panelist` package on **GitHub
Packages**, that is a retired second publish path — the same project, no longer
updated, and not a fork, a private build, or a different edition. Install the
unscoped `panelist` from npmjs.org; it is the canonical package and the only one
that still receives releases.

> **Bring your own model client — required.** panelist bundles **no** live
> model. You inject a provider adapter as `spawn`'s third argument
> (`deps.client`); the **default client throws** rather than run without one, so
> a panel can never silently run un-modelled. In production this wraps a provider
> layer you supply (e.g. PromptFoo/LiteLLM). See
> [the prerequisite below](#personas-identity-is-data-task-is-ephemeral) for the
> adapter shape.

## Use cases

panelist models a synthetic _user_ reacting to any artifact — not just prose.
Reading is one behavior among several; quitting, dismissing, refusing to
forward, refusing to click, and refusing to buy are all in scope:

- **Copy and long-form:** "Given this paragraph, will you read the next one?" — resume review, book-chapter reader panels, blog-post pre-filters.
- **Interface and flow:** "Where in this onboarding would you give up?"
- **Commercial:** "Would you pay for this? At what point do you stop believing the pricing page?"
- **Developer-facing:** "Would you install this? Where does the README lose you?" — OSS-README review.
- **Decision review:** "Given this plan, what would make you walk away?"

The shipped [`packs/business`](#persona-packs-toggleable) pack — a B2C
consumer and a B2B buyer — exists for the commercial use cases above; it is
as central to panelist as [`packs/review`](#persona-packs-toggleable)'s
OSS-code-review archetypes, not an afterthought bolted onto a prose-review
tool.

### Multi-turn junction walks

For the "will you read the next one?" use cases — walking a persona through a book
(branching hub-and-spoke) or a blog post (a linear chain) **one junction at a time**,
behind a structural information barrier — see the
[junction contract](docs/junction-contract.md). It covers graph authoring, the engine
guarantees (barrier, always-available bail, patience budget), and the consumer verdict
hook, with two runnable worked examples ([branching](examples/junction-branching.mjs),
[linear-chain](examples/junction-linear-chain.mjs)).

## Personas: identity is data, task is ephemeral

A persona is a durable **identity** record (what it rewards, punishes, and quits over). The **task** (vote / comment / converse) is supplied by the caller at invocation time — so one definition answers any instruction, with no new consumer script per use case. See [`docs/invocation-contract.md`](docs/invocation-contract.md) for the formal task/response envelope. For the agentic plane, `src/lib/runner.mjs` (`renderRunnerPrompt` / `runPersona`, backing `.claude/agents/persona.md`) is a single generic runner for ANY registered persona by id — no per-persona agent files.

A persona may also carry an optional `modelTier` — a register-carried default model tier ("this panel runs at `sonnet`"), so you don't have to pass `model` at every `spawn`/`runPersona` call site. It's opaque and unvalidated, purely execution-shaping (never part of the rendered prompt), and a per-call `model` always overrides it. See ["Model tier resolution"](docs/invocation-contract.md#model-tier-resolution-panelist119-companion-to-cwc1879) in the invocation contract.

> **Prerequisite:** panelist bundles **no live model**. You inject a client as
> `spawn`'s third argument (`deps.client`) — its shape is
> `{ model, complete: async ({ prompt }) => ({ ok, text, model }) }`, the same
> adapter `score.mjs` uses. In production this wraps a provider layer you
> supply (e.g. PromptFoo/LiteLLM); the default client throws so you can never
> accidentally run without
> one. See [`docs/invocation-contract.md`](docs/invocation-contract.md).

```js
import { spawn, registerPersonas } from "panelist";
import reviewPack from "panelist/packs/review";

registerPersonas(reviewPack);

// A trivial stub client — swap the body for a real provider call.
const client = {
  model: "your-model",
  async complete({ prompt }) {
    // Call your provider with `prompt` and return its raw text. The reply must
    // be a JSON object in the wrapper's own shape — `verdict` (per the
    // `responseSchema` you supplied) and `message` — not an ad-hoc shape.
    return {
      ok: true,
      text: '{ "verdict": { "pass": false, "frictionPoint": "install command buried" }, "message": "stub" }',
      model: "your-model",
    };
  },
};

const readmeText = "# my-project\n\nInstall: npm i my-project\n"; // the draft under review
const result = await spawn(
  "drive-by-installer",
  {
    mode: "vote",
    artifact: readmeText,
    instruction: "Would you stop reading before you found the install command?",
    // `verdict` is filled IFF you supply a `responseSchema`. Omit this and
    // `result.verdict` comes back `null`, whatever the client returned.
    responseSchema: { pass: "boolean", frictionPoint: "string" },
  },
  { client },
);

console.log(result.verdict);
// { pass: false, frictionPoint: 'install command buried' }
```

## Persona packs (toggleable)

Packs are exported but **nothing auto-registers** — a consumer opts in explicitly. Shipped example packs:

- **`packs/review`** — OSS-code-review archetypes (drive-by-installer, production-evaluator, maintainers-maintainer, drive-by-contributor).
- **`packs/business`** — a middle-class B2C consumer and a B2B buyer, for the "would you click / would you buy / would you read on" use cases.

These are **examples**. Real, private persona rosters live in their owner's repo and register at runtime; they are never shipped here.

## Eval: contract conformance (manual, spends tokens)

`eval/contract-conformance.mjs` is a **manually-triggered** harness that answers one
narrow question: does panelist's **default** prompt reliably produce output that
panelist's **own parser** can consume, on every model panelist claims to support? It
checks **parseability only** — not persona/verdict quality — across the scoring,
single-turn (`comment`/`vote`), and multi-turn (`runJunctionLoop`) planes, plus a
zero-cost check that `providerOf()` still buckets each model id correctly (the guard
behind the `crossModel` guarantee).

It calls real provider APIs and **spends real tokens**, so it is intentionally kept
out of both `npm test` (it lives under `eval/`, not `test/`, so `node --test
test/*.test.mjs` never picks it up) and CI (the matching workflow is
`workflow_dispatch`-only — see `.github/workflows/eval-contract-conformance.yml`). It
must never become a required check.

Run it:

- **Manually via GitHub Actions** — dispatch the "Eval - Contract Conformance"
  workflow (requires the maintainer to have provisioned `ANTHROPIC_API_KEY` /
  `OPENAI_API_KEY` via 1Password first; see the workflow file's header comment).
- **Locally** — `ANTHROPIC_API_KEY=... OPENAI_API_KEY=... node eval/contract-conformance.mjs`
  (a provider with no key set is skipped with a clear message, not treated as a
  failure).

Run it when adding a new provider, or upgrading/retiring a model id in the supported
lineup. See [`eval/README.md`](eval/README.md) for the full matrix shape and details.

## Eval: tool-injection (manual, spends tokens)

`eval/tool-injection.mjs` is a **small security regression test** (four cases, not an
eval suite, not fuzzing) that checks whether the tool-isolation gate
(`src/lib/isolation.mjs`) holds when a **real model** is induced, via injected
artifact text, into unauthorized tool use. It asserts the gate's own behavior
(`isolation.tools` / `isolation.denied`) — never model wording, never verdict
quality. See [`docs/invocation-contract.md#tool-isolation-panelist72`](docs/invocation-contract.md#tool-isolation-panelist72)
for the isolation contract itself.

Run it:

- **Manually via GitHub Actions** — dispatch the "Eval - Tool Injection" workflow
  (`.github/workflows/eval-tool-injection.yml`, `workflow_dispatch` only; needs the
  same 1Password-provisioned `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` as the
  contract-conformance eval — see [#108](https://github.com/Kromatic-Innovation/panelist/issues/108)).
- **Locally** — `ANTHROPIC_API_KEY=... OPENAI_API_KEY=... node eval/tool-injection.mjs`
  (a provider with no key set is skipped, not treated as a failure). With no
  credentials at all it still runs `--self-test` (the same four cases' assertion
  logic against panelist's own mock tool-attempting client) so the gate-assertion
  code path is proven correct offline.

Run it after touching `isolation.mjs` or any of the prompt builders (`buildSpawnPrompt`,
`buildEvalPrompt`, the junction loop's `CONTRACT`).

It spends real tokens and is manual-only — never wired to `push`/`pull_request`, never
a required check. **A pass on the `"""`-fence case does NOT close panelist#82** —
injected verdict/axis-score manipulation is a separate, ungated surface that needs no
tools at all; a pass here only means one model on one payload didn't take the bait.
See the file header comment in `eval/tool-injection.mjs` for the full case-by-case
reasoning.

## Status

Early. Developed internally, then open sourced. Apache-2.0.
