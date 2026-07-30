# eval/ — contract-conformance harness

This directory holds **manually-triggered evals**, not tests. It is deliberately
outside `test/` (so `npm test` / `node --test test/*.test.mjs` never runs it) and
outside `package.json`'s `files` array (so it is never published to npm).

## `contract-conformance.mjs` (panelist#95)

**What it checks:** does panelist's DEFAULT prompt (`buildEvalPrompt`,
`buildSpawnPrompt`, the junction loop's built-in `CONTRACT` prompt) reliably produce
output that panelist's OWN parser (`extractScore`, `extractJsonObject`) can consume,
on every model panelist claims to support?

**What it does NOT check:** persona/verdict quality. A model that returns
well-formed-but-bad judgement passes this eval — that is by design. This is a
contract/parseability check, not a quality eval.

For each model in the `MODELS` table (edit in place to add/remove/rename a supported
model — **re-verify the ids against the live provider catalogs first**, they are
correct only as of the date noted in the file header) it runs four planes against the
real shipped `packs/review` persona and a minimal real junction graph — no custom
`deps.buildPrompt` override anywhere in this file, so the DEFAULT prompts are what's
actually exercised:

| Plane | Entry point | Pass condition |
|---|---|---|
| `scoring` | `score()` | `extractScore()` parses; every rubric axis is a number in `[0,10]`; `panelistsFailed === 0` |
| `singleTurn` | `spawn()` mode `comment` | `extractJsonObject()` parses; `message` is non-empty; `dealKillers` is an array |
| `singleTurnSchema` | `spawn()` mode `vote` + `responseSchema` | `verdict` is non-null |
| `multiTurn` | `runJunctionLoop()` | every turn yields a decision; the run does not end `invalid-decision` on turn 1 |

It also asserts `providerOf()` buckets every model id to the expected provider
(`"anthropic"` / `"openai"`) — this check makes **no API call**, runs unconditionally,
and is the only place that would catch a new model-naming scheme silently breaking
the `crossModel` cross-provider guarantee.

**Output:** a readable matrix — rows are models, columns are planes, cells are
`PASS` / `FAIL (reason)` / `SKIP (reason)`. Exit code is non-zero iff at least one
*attempted* cell failed; a provider skipped for a missing API key is not a failure.

### Running it

```bash
# Locally, spends real tokens for whichever key(s) are set:
ANTHROPIC_API_KEY=... OPENAI_API_KEY=... node eval/contract-conformance.mjs

# Without credentials — still runs the free providerOf() bucketing check and
# prints a clear "skipped: no <PROVIDER>_API_KEY" row per plane; exits 0.
node eval/contract-conformance.mjs
```

Or dispatch `.github/workflows/eval-contract-conformance.yml` from the Actions tab
(`workflow_dispatch` only — it is never wired to `push` or `pull_request`, and must
never be made a required check).

### When to run it

- Adding support for a new provider.
- Upgrading or retiring a model id in the supported lineup (`MODELS` table).
- Any time the default prompt builders (`buildEvalPrompt`, `buildSpawnPrompt`, the
  junction loop's `CONTRACT`) or the parsers they feed (`extractScore`,
  `extractJsonObject`) change.

### Zero dependencies

Provider calls use Node 20's built-in global `fetch` directly against the Anthropic
Messages API and the OpenAI Chat Completions API — no SDK. Nothing is added to
`dependencies` or `devDependencies` (see `SECURITY.md`).
