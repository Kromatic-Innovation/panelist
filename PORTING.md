# Engine port plan (cwc#1320 S1)

This repo is scaffolded; the engine code port from the internal `persona-review` skill is the remaining work of S1.

## To port from `code-workspace-config/.claude/skills/persona-review/`

| source | dest | change |
|---|---|---|
| `lib/register.mjs` | `src/lib/register.mjs` | generalize the loader to compose multiple record sources + add a runtime `registerPersonas()` |
| `lib/score.mjs` | `src/lib/score.mjs` | keep the cross-model ≥2-provider guarantee; swap bespoke provider dispatch for a PromptFoo/LiteLLM adapter |
| `lib/drift-check.mjs` | `src/lib/drift-check.mjs` | repo-scoped (drop the monorepo `DEFAULT_ROOT_DIR` scan) |
| `data/register.json` schema block | `src/lib/schema.mjs` | the persona schema; v2 (`rewards`/`punishes`/`quitsWhen`) evolves here — #1263 slice B |

## Records

- **Do NOT port the private/real personas** (kromatic pieter/johanna, social chase/buster, rosie x4, jauss x5) — they stay in their owner repos and register at runtime.
- **`packs/review`**: the 4 `zenodotus-*` records from cwc `register.json` become this public demo pack.
- **`packs/business`**: authored fresh here (see packs/business/) — not sourced from a private roster.

## Contract (#1263 slice E)

`spawn(personaId, { mode: vote|comment|converse, artifact, instruction, responseSchema?, horizon? })` → `{ personaId, mode, verdict|null, message, dealKillers[] }`.
