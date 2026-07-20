# plenum

**A synthetic persona panel that tells you where readers _quit_ — not how much they'd like it.** Cross-model by default to fight self-preference bias, and honest by construction that it's a cheap pre-filter, not user research.

> ⚠️ **What plenum is and is not for.** A synthetic persona is a *model* of a customer, and your model of the customer is wrong — that is why you talk to real people. plenum is legitimate as a **drafting aid**, a **cheap pre-filter** to kill obviously-weak drafts before spending a human's attention, and a way to catch obvious misses. It is **not** evidence about real readers, **not** a substitute for talking to them, and **not** validation. "Our personas responded well to this" is a sentence this tool is designed to make hard to write.

## Why it's different

Most tools that spawn personas emit a warmth/viability *score* — the exact output that invites "look, the AI loves it" misuse. plenum's primary output is a **deal-killer / cut-list**: *where would this reader stop, dismiss, or refuse to forward?* Abandonment is behavioural and far more robustly simulable than affect.

- **Deal-killers, not scores.** The default verdict is a cut-list, not a rating.
- **Cross-model panels.** ≥2 providers by default (built on a provider abstraction — PromptFoo/LiteLLM — not hand-rolled) to counter same-model self-preference / sycophancy bias.
- **Diversity by kill-condition.** Personas differ by *what makes them quit*, not by demographics. Identity is behavioural (`rewards` / `punishes` / `quitsWhen`), never age/employer/tenure.
- **Honesty by construction.** Every panel output auto-stamps the caveat above.
- **Calibration hooks.** Join synthetic verdicts to real downstream signal and rank personas by how well they *predict*, not how well they *read*.

See [`docs/synthetic-persona-best-practices.md`](docs/synthetic-persona-best-practices.md) for the governing rules behind these design choices (specificity over decoration, demographics vs. behaviour, anti-sycophancy, panel diversity, calibration, and the honesty line).

## Use cases

- "Give me feedback on this."
- "Would you click on this tweet?"
- "Given this paragraph, will you read the next one?"
- Resume review, book-chapter reader panels, blog-post pre-filters, OSS-README review.

## Personas: identity is data, task is ephemeral

A persona is a durable **identity** record (what it rewards, punishes, and quits over). The **task** (vote / comment / converse) is supplied by the caller at invocation time — so one definition answers any instruction, with no new consumer script per use case. See [`docs/invocation-contract.md`](docs/invocation-contract.md) for the formal task/response envelope. For the agentic plane, `src/lib/runner.mjs` (`renderRunnerPrompt` / `runPersona`, backing `.claude/agents/persona.md`) is a single generic runner for ANY registered persona by id — no per-persona agent files.

```js
import { spawn } from "@kromatic-innovation/plenum";
import reviewPack from "@kromatic-innovation/plenum/packs/review";

registerPersonas(reviewPack);
const verdict = await spawn("drive-by-installer", {
  mode: "vote",
  artifact: readmeText,
  instruction: "Would you stop reading before you found the install command?",
});
```

## Persona packs (toggleable)

Packs are exported but **nothing auto-registers** — a consumer opts in explicitly. Shipped example packs:

- **`packs/review`** — OSS-code-review archetypes (drive-by-installer, production-evaluator, maintainers-maintainer, drive-by-contributor).
- **`packs/business`** — a middle-class B2C consumer and a B2B buyer, for the "would you click / would you buy / would you read on" use cases.

These are **examples**. Real, private persona rosters live in their owner's repo and register at runtime; they are never shipped here.

## Status

Early. Extracted from an internal persona-review engine (Kromatic-Innovation cwc#1320 / #1263). Apache-2.0.
