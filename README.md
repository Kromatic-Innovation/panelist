# panelist

[![CI](https://github.com/Kromatic-Innovation/panelist/actions/workflows/ci.yml/badge.svg)](https://github.com/Kromatic-Innovation/panelist/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://github.com/Kromatic-Innovation/panelist/blob/main/LICENSE)
[![npm version](https://img.shields.io/npm/v/panelist)](https://www.npmjs.com/package/panelist)

![panelist: three panelists reading a draft with exit-doors above their heads, a moderator directing the session](docs/assets/hero.png)

**Use case:** you have a draft — marketing copy, a landing page, a pitch, a chapter — and want a fast, cheap read on where a real reader would bail, before you spend a human's attention on it.

**Differentiator:** most synthetic-panel tools return a warmth/viability score, which invites "the AI loved it" misuse. panelist's primary output is a **deal-killer / cut-list**: the exact point a persona would quit, dismiss, or refuse to forward — abandonment is behavioral and far more reliably simulable than affect. Panels are cross-model by default (fighting same-model self-preference bias), personas differ by *what makes them quit* rather than demographics, and every output auto-stamps the honesty caveat that this is a pre-filter, not user research.

**Why:** a 9/10 score from a model that wants to please you is worthless as a filter. A specific line where three independent, cross-model personas all bail is an actionable signal — that's the difference panelist is built around.

> ⚠️ **What panelist is and is not for.** A synthetic persona is a *model* of a customer, and your model of the customer is wrong — that is why you talk to real people. panelist is legitimate as a **drafting aid**, a **cheap pre-filter** to kill obviously-weak drafts before spending a human's attention, and a way to catch obvious misses. It is **not** evidence about real readers, **not** a substitute for talking to them, and **not** validation. "Our personas responded well to this" is a sentence this tool is designed to make hard to write.

## Why it's different

Most tools that spawn personas emit a warmth/viability *score* — the exact output that invites "look, the AI loves it" misuse. panelist's primary output is a **deal-killer / cut-list**: *where would this reader stop, dismiss, or refuse to forward?* Abandonment is behavioural and far more robustly simulable than affect.

- **Deal-killers, not scores.** The default verdict is a cut-list, not a rating.
- **Cross-model panels.** ≥2 providers by default (designed to wrap a provider layer you supply, e.g. PromptFoo/LiteLLM — not hand-rolled) to counter same-model self-preference / sycophancy bias.
- **Diversity by kill-condition.** Personas differ by *what makes them quit*, not by demographics. Identity is behavioural (`rewards` / `punishes` / `quitsWhen`), never age/employer/tenure.
- **Honesty by construction.** Every panel output auto-stamps the caveat above.
- **Calibration hooks.** Join synthetic verdicts to real downstream signal and rank personas by how well they *predict*, not how well they *read*.

See [`docs/synthetic-persona-best-practices.md`](docs/synthetic-persona-best-practices.md) for the governing rules behind these design choices (specificity over decoration, demographics vs. behaviour, anti-sycophancy, panel diversity, calibration, and the honesty line).

## Install

```bash
npm i panelist
```

panelist is published to the public npm registry as the unscoped package
`panelist` (via OIDC Trusted Publishing — no token needed): owned by Kromatic
Innovation; published to npm from the `trikro` account. No `.npmrc` changes
required.

## Use cases

- "Give me feedback on this."
- "Would you click on this tweet?"
- "Given this paragraph, will you read the next one?"
- Resume review, book-chapter reader panels, blog-post pre-filters, OSS-README review.

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
    // call your provider with `prompt`, return its raw text
    return { ok: true, text: '{ "verdict": "keep", "note": "stub" }', model: "your-model" };
  },
};

const readmeText = "# my-project\n\nInstall: npm i my-project\n"; // the draft under review
const verdict = await spawn(
  "drive-by-installer",
  {
    mode: "vote",
    artifact: readmeText,
    instruction: "Would you stop reading before you found the install command?",
  },
  { client },
);
```

## Persona packs (toggleable)

Packs are exported but **nothing auto-registers** — a consumer opts in explicitly. Shipped example packs:

- **`packs/review`** — OSS-code-review archetypes (drive-by-installer, production-evaluator, maintainers-maintainer, drive-by-contributor).
- **`packs/business`** — a middle-class B2C consumer and a B2B buyer, for the "would you click / would you buy / would you read on" use cases.

These are **examples**. Real, private persona rosters live in their owner's repo and register at runtime; they are never shipped here.

## Status

Early. Extracted from an internal persona-review engine. Apache-2.0.
