# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**Pre-1.0 (0.x) semantics apply.** While panelist is at a `0.x` major version,
MINOR releases (`0.x.0`) may include breaking changes, and PATCH releases
(`0.0.x`) are reserved for backwards-compatible fixes. Once the project
reaches `1.0.0`, standard semver discipline (breaking changes only on MAJOR)
takes over.

## [Unreleased]

**Minor under pre-1.0 semantics** — changes an observable verdict.

### Changed

- **GitHub Packages publishing retired in favor of public npm
  ([#123](https://github.com/Kromatic-Innovation/panelist/issues/123)).**
  `.github/workflows/publish.yml`, which published a second, org-scoped copy of
  every release to GitHub Packages as `@kromatic-innovation/panelist` on
  `release: published`, has been deleted. panelist now has exactly one publish
  path: the unscoped `panelist` package on the public npm registry, published by
  `.github/workflows/release.yml` on a pushed `v*` tag via OIDC Trusted
  Publishing. Consumers already installed from public npm, so no install
  instructions change. `package.json`'s `publishConfig.registry` pin to
  `npm.pkg.github.com` — which existed solely for the retired workflow, and
  which `release.yml` stripped in-CI before every public publish — has been
  removed with it. Nothing already published to GitHub Packages was unpublished;
  this only stops future publishes. Also closes the Scorecard
  `TokenPermissionsID` alert for the deleted workflow's top-level
  `packages: write` scope.

### Added

- **Persona records may carry an optional register-carried `modelTier`
  ([#119](https://github.com/Kromatic-Innovation/panelist/issues/119), companion to cwc#1879).** A persona can now declare a default
  model tier once (e.g. `modelTier: "sonnet"`) instead of requiring `model` at
  every `spawn`/`runPersona` call site. Resolved in `src/lib/spawn.mjs`,
  most-specific-wins: an explicit per-call `task.model`/`opts.model`
  (panelist#113) always overrides `persona.modelTier`; with neither set, the
  `model` key is left off the `complete()` call entirely, same as today. Like
  `model`/`tools`, `modelTier` is purely execution-shaping — it is not in
  `PERSONA_FIELDS` and never affects the rendered prompt
  (`renderRunnerPrompt`/`buildSpawnPrompt` output is byte-identical with or
  without it), and it is not validated against any model catalog. A
  `registerPersonas` object source (`{ personas, rubrics?, usage?,
  modelTier? }`) may also set a source-level default `modelTier` applied to
  every record from that source that doesn't set its own; a per-record
  `modelTier` always wins. Additive and optional throughout — omitting
  `modelTier` leaves today's behavior byte-identical; `SCHEMA_VERSION` stays
  at `2`. See `docs/invocation-contract.md`'s "Model tier resolution" section.

- **New manual eval: tool-use prompt-injection regression against real models
  ([#96](https://github.com/Kromatic-Innovation/panelist/issues/96)).** `eval/tool-injection.mjs` is a small, manually-triggered (never
  CI, never a required check) security regression test — four adversarial
  cases, not an eval suite, not fuzzing — that confirms the tool-isolation
  gate (`src/lib/isolation.mjs`) holds when a real model (one Anthropic, one
  OpenAI) is induced, via injected artifact text, into unauthorized tool
  use. Every assertion reads the gate's own `isolation.tools`/
  `isolation.denied` envelope, never model wording or verdict quality. Case
  2 confirms a granted tool stays usable after an ungranted attempt is
  denied (no false-positive lockout); Case 3 confirms the `DISCOVERY_TOOLS`
  closed-under-discovery invariant against a live model; Case 4 exercises
  the `"""`-fence neutralization from [#82](https://github.com/Kromatic-Innovation/panelist/issues/82) but is explicitly documented as
  weak evidence that does **not** close [#82](https://github.com/Kromatic-Innovation/panelist/issues/82) (a separate, ungated
  verdict/axis-score-injection surface). Factored the raw-`fetch` provider
  adapter plumbing out of `eval/contract-conformance.mjs` into a new shared
  `eval/_adapters.mjs` (re-pointed [#95](https://github.com/Kromatic-Innovation/panelist/issues/95)'s import; [#95](https://github.com/Kromatic-Innovation/panelist/issues/95)'s own behavior is
  unchanged) and added `toolCapableAnthropicClient`/
  `toolCapableOpenaiClient`, which expose a fixed probe tool set
  (`recall`/`web_fetch`/`tool_search`) at the provider API level and report
  every attempted-but-ungranted call via `deniedToolCalls`. With no
  credentials, `node eval/tool-injection.mjs` (or `--self-test`) runs the
  same four cases' assertion logic against panelist's own mock
  tool-attempting client (`test/_helpers.mjs`), proving the gate-assertion
  code path offline. Zero added dependency. Triggered via
  `.github/workflows/eval-tool-injection.yml` (`workflow_dispatch` only;
  same 1Password credentials as [#95](https://github.com/Kromatic-Innovation/panelist/issues/95), tracked by [#108](https://github.com/Kromatic-Innovation/panelist/issues/108)). See the new "Eval:
  tool-injection" README section and `eval/README.md`.

- **New manual eval: contract conformance across supported models ([#95](https://github.com/Kromatic-Innovation/panelist/issues/95)).**
  `eval/contract-conformance.mjs` is a manually-triggered (never CI, never a
  required check) harness that checks whether panelist's DEFAULT prompts
  (`buildEvalPrompt`, `buildSpawnPrompt`, the junction loop's `CONTRACT`)
  reliably produce output panelist's OWN parsers (`extractScore`,
  `extractJsonObject`) can consume, across all 6 models panelist claims to
  support (3 Anthropic, 3 OpenAI) and all 4 execution planes (scoring,
  single-turn comment, single-turn vote+schema, multi-turn junction). It also
  asserts `providerOf()` buckets every model id correctly (the guard behind
  the `crossModel` guarantee) with no API call required. Parseability only —
  not verdict/persona quality. Zero added dependency: provider calls use
  Node 20's built-in `fetch` directly, no SDK. Lives under `eval/`, not
  `test/` or `package.json`'s `files`, so it never runs via `npm test` and is
  never published. Triggered via `.github/workflows/eval-contract-conformance.yml`
  (`workflow_dispatch` only). See the new "Eval: contract conformance"
  README section and `eval/README.md`.

- **`maxTokens`/`temperature` are now injectable, and scoring/spawn/junction
  failures are diagnosable ([#85](https://github.com/Kromatic-Innovation/panelist/issues/85)).** The three model-call sites
  (`score.mjs`'s `scoreCandidate`, `spawn.mjs`'s `spawn`, `junction.mjs`'s
  `runJunctionLoop`) previously hardcoded `maxTokens`/`temperature`,
  divergently (512 vs. 1024) and non-overridably. All three now read
  `deps.maxTokens ?? <named default>` / `deps.temperature ?? <named
  default>` (nullish coalescing, so an explicit `0` is honored), defaulting
  to today's values — `SCORE_MAX_TOKENS = 512` on the scoring plane,
  `DEFAULT_MAX_TOKENS = 1024` on spawn/junction, `DEFAULT_TEMPERATURE = 0`
  everywhere. The 512-vs-1024 divergence is preserved and documented
  in-line, not silently unified — whether the two planes should converge is
  a separate product decision this issue explicitly defers.
  Additionally, `scoreCandidate`'s result (both the live-panel path and the
  `neutralFallback` path) now carries `panelSize` (total persona x panelist
  tasks attempted), `panelistsReported` (how many produced a usable score),
  and `failuresByCause: { transport, unparsable }` — a breakdown of the
  existing `panelistsFailed` total that distinguishes a transport-level
  failure from a reply that came back but didn't parse (the bucket a
  `maxTokens`-truncated reply lands in). `panelistsFailed` itself is
  unchanged for back-compat; all new fields are additive.

### Changed

- **De-duplicated `normalizeReportedDenial` across the three execution
  planes ([#90](https://github.com/Kromatic-Innovation/panelist/issues/90)).** `score.mjs`, `spawn.mjs`, and `junction.mjs` each defined
  an identical private `normalizeReportedDenial(entry, reviewer)` helper
  that normalizes a client-reported denial (a bare tool-id string, or a
  `{ tool, at }` object) into the locked `isolation.denied[]` shape via
  `recordDenial`. It now has one implementation, exported from
  `src/lib/isolation.mjs` alongside `recordDenial`/`createToolGate`/
  `buildIsolationEnvelope`; all three planes import it instead of defining
  their own copy. Reviewer attribution is unchanged and still differs per
  plane at the call site (`persona.id` in score, `personaId` in spawn,
  `reviewerFor(persona)` in junction). Pure structural move — no behavior
  change.

- **Broke the `junction.mjs` <-> `junction-schema.mjs` import cycle ([#89](https://github.com/Kromatic-Innovation/panelist/issues/89)).**
  The two modules imported from each other (`junction.mjs` imported
  `buildTrace`/`normalizeEngagement` from `junction-schema.mjs`, which
  imported `BAIL` back from `junction.mjs`). It was harmless today only by
  accident of where the reference sat, and a future module-scope use of
  either binding would have turned it into a TDZ `ReferenceError` with a
  misleading stack trace. `BAIL`'s definition now lives in a new leaf
  module, `src/lib/junction-constants.mjs`, which imports from neither
  file; `junction.mjs` re-exports `BAIL` from there so `import { BAIL }
  from "panelist"` (`src/index.mjs`) is unaffected. Pure structural move —
  no behavior change.

### Docs

- **`isolation.tools` documented as the effective set, not a union across
  differentiated reviewers ([#139](https://github.com/Kromatic-Innovation/panelist/issues/139), companion to
  [zenodotus#82](https://github.com/Kromatic-Innovation/zenodotus/issues/82)).**
  `unionTools`' docstring, the "Assembling a panel" bullet in
  `docs/invocation-contract.md`, and the `src/index.mjs` export comment
  previously described the panel-level `isolation.tools` as a union across
  per-persona tool sets. That framing implied a per-reviewer allowlist
  configuration surface that does not exist in either implementation:
  `createToolGate` derives the allowlist from `opts.tools` alone, and the
  `reviewer` it also takes is used only to attribute denials. Per
  PANEL_VERDICT_SPEC **1.2**, the top-level value is now described as the
  *effective set* applied uniformly across reviewers. Accumulating across
  calls is unchanged and still correct — a provider may grant a different set
  per call, and the accumulated value is the effective set the verdict was
  produced under. Wording only; `unionTools`' implementation is untouched and
  no observable behavior changes. Adds a lock-in test mirroring zenodotus's
  ("two reviewers under one config resolve to identical allowlists") so the
  two independent implementations cannot drift on what the field means.

- **README and best-practices doc reconciled with actual cross-model and
  kill-floor behavior ([#87](https://github.com/Kromatic-Innovation/panelist/issues/87)).** README's "Cross-model panels" bullet and
  intro line read as if panelist enforced a ≥2-provider panel by default;
  in fact panelist bundles no provider layer, cannot compose the panel for
  the caller, and a single-provider panel runs to completion and returns
  `crossModel: false` — the flag is reported, not enforced. Both spots now
  say so explicitly. Separately, `docs/synthetic-persona-best-practices.md`'s
  "Kill-floors" bullet described a panel-level kill-rate signal that no code
  computes; it's now annotated `(not yet implemented in panelist)` and
  distinguished from the unrelated, already-implemented per-axis
  `killAxes`/`killFloor` verdict rule in `score.mjs`. No behavior changed.

### Security

- **OSS "go-public" workflow gates revisited against live platform behavior
  ([#84](https://github.com/Kromatic-Innovation/panelist/issues/84)).** Both `dependency-review.yml` and `scorecard.yml` carried in-file
  instructions to flip a setting "at the OSS go-public gate"; the repo is
  public and published (`0.3.0` on npm) but the flips were never made. Both
  were attempted and **observed** (2026-07-30), since third-party platform
  behavior must be checked, not recalled:
  - `scorecard.yml` — **flipped.** `publish_results: true` (publishing the
    OpenSSF rating is the point of running Scorecard on a public project) and
    `continue-on-error` dropped on all three steps, so a broken run is visible
    rather than silently green. Scorecard runs only on the default branch, so
    this is verified by the push-to-`develop` run after merge (it does not run
    on PRs by design).
  - `dependency-review.yml` — **could not be flipped; kept advisory with an
    accurate reason.** Dropping `continue-on-error` was observed to hard-fail
    with *"Dependency review is not supported on this repository. Please ensure
    that Dependency graph is enabled"* — the Dependency graph feature is not
    enabled for this repo, and enabling it requires repo/org **admin**
    (unavailable to the automation). `continue-on-error` is retained so it
    doesn't paint every PR red; a follow-up issue tracks the admin action to
    enable Dependency graph, after which the flip completes.
  - The stale "ADVISORY until go-public" comments in both files were replaced
    with comments describing the *actual* current state, so they no longer
    mislead the next reader into thinking the repo is private.

- **An untrusted artifact could break out of its `"""` fence and inject
  content into the prompt ([#82](https://github.com/Kromatic-Innovation/panelist/issues/82)).** All three prompt builders
  (`buildEvalPrompt` in `score.mjs`, `buildSpawnPrompt` in `spawn.mjs`, and
  the current-junction view in `junction.mjs`) fenced untrusted artifact/
  content text with a raw, unescaped `` `"""${text}"""` `` interpolation.
  An artifact whose own text contained `"""` could close that fence early,
  and whatever followed would flow past the intended containment as if it
  were prompt scaffold rather than untrusted input. On the SCORE plane this
  was the worst case: injected axis JSON placed right after the broken
  fence reaches `extractScore`/`decideVerdict` with no caller-side
  validation point, so a crafted artifact could forge its own score and
  flip a `cut` verdict to `keep`.

  Added `fenceArtifact(text)` (`score.mjs`, exported alongside
  `renderPersona`/`extractJsonObject` for `spawn.mjs`/`junction.mjs` to
  import) that neutralizes any internal run of 3-or-more `"` characters
  (inserting a zero-width space between each) before wrapping the text in
  `"""` fences — deterministic, visually lossless, and guarantees the only
  `"""` substrings in the built prompt are the two intended fences. All
  three call sites now go through the shared helper. Added
  `test/fence-injection.test.mjs` with a regression test per call site
  (score/spawn/junction) plus a test specifically asserting the injected
  axis JSON on the score plane cannot reach the reply-parsing path as if it
  were the model's own output.

### Fixed

- **Polynomial ReDoS in the markdown-fence regex of `extractJsonObject()`
  ([#122](https://github.com/Kromatic-Innovation/panelist/issues/122), CodeQL alert 10, `js/polynomial-redos`, high).** The regex in
  `src/lib/score.mjs` carried an ambiguous quantifier pair — a `\s*` sitting
  immediately before the lazy `([\s\S]*?)` — so an unterminated fence followed
  by a long whitespace run made the engine retry every split point between the
  two, giving quadratic time in the length of that run. Reachable from
  untrusted input: `extractJsonObject` parses model reply text (via
  `extractScore`), which in a panel run can carry attacker-influenced artifact
  content. The `\s*` is dropped; it was redundant, since the next line already
  does `fence[1].trim()`. Behavior-identical for every input (both patterns
  accept the same language, and the only difference — whether leading
  whitespace lands in `\s*` or in the capture group — is erased by that
  `trim()`), so no existing test changed. Measured on a 50k-space
  unterminated fence: ~280ms before, ~0.2ms after (~4.7s vs. ~0.1ms at 200k).
  Regression coverage in `test/score-units.test.mjs`.

- **The honesty caveat is now auto-stamped on every public output surface,
  not just some of them ([#81](https://github.com/Kromatic-Innovation/panelist/issues/81)).** An audit found 8 public surfaces that did
  not carry the `honesty` field despite the docs/README claiming "every
  panel output auto-stamps the caveat":
  - `score()`/`scoreCandidate()` with a custom `deps.fallback` — the
    caller's callback replaced the built-in `neutralFallback` wholesale,
    losing the stamp. The call site now post-processes the callback's
    return through `stampHonesty` (idempotent, so the built-in fallback
    path is unaffected).
  - `rankCandidatesWith()` — the inner per-candidate `.evaluation` objects
    were already stamped, but the returned `{ shortlist, cut }` wrapper
    (the actual cut-list product) was not. Now stamped.
  - `spawn()` — the returned invocation-contract wrapper is now stamped.
    `runPersona()` (`runner.mjs`) delegates to `spawn` unmodified, so it
    inherits the stamp.
  - `runJunctionLoop()` — the returned top-level envelope is now stamped.
    The nested `trace` (and its per-turn reactions) is deliberately left
    UNstamped: its key set is locked (`REACTION_KEYS`/`TRACE_KEYS`,
    `junction-schema.mjs`) and consumers assert it exactly.
  - `aggregateJunctionTraces()` — the returned rollup object is now
    stamped.
  - `calibratePersonas()` — the result already carried honesty *language*
    in its `note` field, but not a `honesty` field, and the note's "NOT
    validation" (uppercase) didn't match the case-sensitive
    `HONESTY_MARKER` ("not validation"). Rather than reshaping `note`, an
    `honesty` field is now added additively via `stampHonesty`.
  - `score()`'s default path and its built-in `neutralFallback` were
    already correctly stamped and are unchanged.

  Added a table-driven test (`test/honesty-surfaces.test.mjs`) that runs
  every one of these surfaces offline and asserts
  `assertHonestyStamped(result).ok === true`, so a future surface added
  without a stamp fails CI. The junction trace's un-stamped status and the
  locked `TRACE_KEYS`/`REACTION_KEYS` are also asserted there. Also updated
  all three copies of the `spawn` response-wrapper contract
  (`docs/invocation-contract.md`, `.claude/agents/persona.md`,
  `src/lib/spawn.mjs`'s JSDoc) to include the `honesty` field, and rewrote
  `docs/invocation-contract.md`'s "Forward-compat" note (previously said
  the stamp was "not yet added") to describe the now-shipped behavior.

- **A total panel failure no longer returns a passing verdict ([#80](https://github.com/Kromatic-Innovation/panelist/issues/80)).** When
  every panelist failed, `scoreCandidate` fell back to a neutral 5 on every
  axis and *derived* the verdict — but the neutral 5 collides with the default
  `cut_threshold` of 5.0, and `decideVerdict` cuts only on
  `overall < cut_threshold`, so a total provider outage returned
  `verdict: "keep"`. A programmatic gate (`if (result.verdict === "keep")
  publish()`) therefore published everything during an outage. The
  neutral-fallback verdict is now pinned to `"cut"` (fail-closed) rather than
  derived; the neutral scores and the "REQUIRES HUMAN REVIEW" note are still
  reported for human context. The magic `5` is now the named constant
  `NEUTRAL_FALLBACK_SCORE`, defined next to `DEFAULT_CUT_THRESHOLD` so the
  collision is visible at the point of definition.

- **CI now actually runs `npm run drift`, matching what CONTRIBUTING.md
  claimed all along ([#83](https://github.com/Kromatic-Innovation/panelist/issues/83)).** `CONTRIBUTING.md` asserted CI runs both
  `npm test` and `npm run drift` and gates on both, but `ci.yml` only ran
  `node --test test/*.test.mjs` — the drift check (`src/lib/drift-check.mjs`,
  a real CLI that resolves `process.exit(1)` on failure) was wired into
  `package.json` but invoked by no workflow, so a drifted/invalid persona
  record could merge without CI ever noticing. Added `npm run drift` as a
  second step in the same CI job. Added a test
  (`test/drift.test.mjs`) that constructs a deliberately-broken record and
  asserts `scanRepo` reports `ok: false` for it, proving the gate actually
  fails on drift rather than always exiting 0.

- **`checkHonesty` had zero call sites — the batch honesty-stamp guardrail
  shipped but nothing ran it ([#86](https://github.com/Kromatic-Innovation/panelist/issues/86)).** `drift-check.mjs`'s `checkHonesty`
  (added alongside #6/#81's per-surface stamping) takes a batch of panel
  summaries/envelopes and reports which omit the honesty caveat, but it was
  never invoked by `main()`, any test, or CI — exactly the kind of gap that
  let [#81](https://github.com/Kromatic-Innovation/panelist/issues/81)'s stamping hole go unnoticed. `checkHonesty` is intentionally NOT
  wired into `drift-check.mjs`'s `main()`/`scanRepo` (those scan repo
  records, not panel summaries; forcing it in there would be wrong). Added
  `test/honesty-gate.test.mjs`, which builds a real batch from every
  execution plane (`score`, `rankCandidatesWith`, `spawn`,
  `runJunctionLoop`, `aggregateJunctionTraces`, `calibratePersonas`) offline,
  asserts `checkHonesty` passes it, then mixes in a deliberately-unstamped
  summary and asserts `checkHonesty` fails with the exact offending
  index/indices — so the gate can now actually fail, and does. This test
  runs under `node --test test/*.test.mjs`, which CI already gates on.
  Also corrected the three prose references to this guardrail
  (`src/index.mjs`'s header comment and `checkHonesty` re-export comment,
  `drift-check.mjs`'s module docstring) so none of them implies
  `main()`/the CLI runs it — they now say the guardrail is exercised in CI
  by the test suite.

- **`package.json`'s version and `PANELIST_VERSION` could drift silently
  ([#88](https://github.com/Kromatic-Innovation/panelist/issues/88)).** The two are kept in sync by a manual release step
  (`CONTRIBUTING.md`), but nothing asserted they matched. Added
  `test/version.test.mjs`, which fails if `src/index.mjs`'s
  `PANELIST_VERSION` diverges from `package.json`'s `version`. Also removed
  a stray `// eslint-disable-next-line no-console` in `drift-check.mjs`'s
  `main()` — the repo has no eslint anywhere, so the directive suppressed a
  rule no tool evaluates.

## [0.3.0] - 2026-07-28

**Breaking.** Bumped as a MINOR under pre-1.0 semantics (see above) because it
changes default behavior for existing callers of `spawn`/`runPersona`.

### Changed

- **Persona tool isolation is now deny-by-default ([#72](https://github.com/Kromatic-Innovation/panelist/issues/72)).** Previously, a
  persona's isolation from ambient tools (an MCP memory server, web search,
  filesystem search) was enforced by prompt instruction only — if the host
  running `spawn`/`runPersona` granted tools, nothing in panelist's output
  revealed it, and a contaminated verdict looked identical to a clean one.
  `spawn(personaId, opts, deps)` and `runPersona` now grant **no tools** by
  default; callers opt in explicitly via `opts.tools: [...]` (or a shared
  `deps.toolGate`). Wildcard/"grant everything" values throw, so a
  tool-discovery/tool-search capability can never be implicitly reopened by
  granting some other tool — isolation is closed under discovery.
- **New `isolation` field on every `spawn`/`runPersona`/`score`/`scoreCandidate`
  envelope:** `{ tools: string[], denied: { tool, reviewer, at }[] }`.
  `tools` is the effective granted set (`[]` = fully isolated); `denied`
  reports attempted-but-denied tool calls rather than swallowing them. New
  module `src/lib/isolation.mjs` (`resolveEffectiveTools`, `isToolGranted`,
  `recordDenial`, `createToolGate`, `buildIsolationEnvelope`, `unionTools`) is
  the deny/allow decision as an independent, testable unit, exported from
  `src/index.mjs`.
- **The multi-turn junction plane is now gated too ([#75](https://github.com/Kromatic-Innovation/panelist/issues/75)).** `runJunctionLoop`
  reached the injected model client with no allowlist, no gate, and no
  `isolation` field on its result — a hole in the same guarantee the rest of
  this release ships, and the worst case for it (a persona holds ambient tool
  access across every turn of a walk, with no envelope at all to inspect
  afterward). `runJunctionLoop` now threads `opts.tools`/`opts.toolGate`
  through the same `isolation.mjs` gate `spawn` uses, routes every per-turn
  `client.complete()` call through it, and returns
  `isolation: { tools, denied }` on every stop path — bail, patience-budget
  exhaustion, terminal, and invalid-decision alike.
- **The programmatic scoring plane is now gated too, closing the last hole
  ([#77](https://github.com/Kromatic-Innovation/panelist/issues/77)).** `scoreCandidate`/`score` accepted `deps.tools` and reported it in
  the `isolation` envelope as granted, but never forwarded it to the injected
  panel and never checked anything — `isolation.denied` was hardcoded `[]`.
  An envelope reporting enforcement it never performed is worse than no
  envelope: it turned "unknown" into a false "verified". `scoreCandidate` now
  builds a `createToolGate` from `deps.tools`/`deps.toolGate`, forwards the
  gated tool set to every `panelist.complete()` call, and merges the gate's
  own denials with adapter-reported `res.deniedToolCalls` into the envelope —
  the same posture `spawn`/`runJunctionLoop` already had. The neutral/
  heuristic-fallback path (no model client invoked) is unchanged: it still
  emits `{ tools: [], denied: [] }` unconditionally, which is honest because
  no client is ever called on that path.
- Documented the isolation guarantee in the README next to the honesty
  caveat — "a persona sees the artifact and nothing else" is now a structural
  claim, not an aspiration.
- README broadened from a readers-and-drafts framing to synthetic users of
  any artifact ([#73](https://github.com/Kromatic-Innovation/panelist/issues/73)): the opening use-case paragraph, the use-cases list (now
  spanning copy, interface/flow, commercial, developer-facing, and decision
  review), and the `business` pack's motivation no longer read as prose-only.
  The honesty caveat itself is unchanged. `package.json`'s `description` and
  the repository "About" blurb were updated to match, so registry/GitHub copy
  doesn't re-seed the narrow framing.

## [0.2.1] - 2026-07-24

Release-pipeline verification patch. **No source, API, documentation, or
behavioural changes** — the published tarball is byte-identical to `0.2.0`.
The only commits since that tag touch `.github/workflows/`, `.gitignore`, and
`package-lock.json`, none of which ship (`files` is `["src", "packs"]`, and
README is unchanged).

This release exists to exercise the npm **trusted-publishing** path end to end.
Every prior CI publish attempt failed: the npm Trusted Publisher for this
package had an `Environment name` of `main`, while `release.yml` declares no
`environment:`, so the OIDC token carried no environment claim and the
mismatch surfaced as an opaque `404 PUT` rather than an auth error. `0.2.0`
itself was published manually as a result. With the Trusted Publisher
corrected to a blank environment, this is the first release that can prove the
automated path works — and a version bump is required because npm refuses to
re-publish an existing version.

### Changed

- CI only, nothing shipped: adopted the canonical Internal Platform
  `promote-main.yml`; committed `package-lock.json` so `npm ci` is reproducible;
  gitignored the generated `.agents/` and `.codex/` directories; pinned the
  release workflow to the `npm@11` line (npm ≥ 11.5.1 is the trusted-publishing
  floor, and `npm@latest` is now 12, which drops Node 20).

### Note

The proposal to replace this repo's inline `release.yml` with a shared
cross-repo reusable workflow was **withdrawn** ([#59](https://github.com/Kromatic-Innovation/panelist/issues/59), PR [#62](https://github.com/Kromatic-Innovation/panelist/issues/62)): a public repo
cannot call a reusable workflow hosted in a private one, so it could never
execute. The shared-template goal moves to a sync-and-drift-check model
(code-workspace-config#1559), leaving this repo's working inline workflow in
place.

## [0.2.0] - 2026-07-21

New MINOR release (pre-1.0 semantics — see above): the multi-turn **junction
contract** subsystem landed as a new public feature across [#46](https://github.com/Kromatic-Innovation/panelist/issues/46)/#47/#48, so this
is the release it belongs to, distinct from the `0.1.1` docs-only patch. Bundles
the still-unreleased leak-sweep documentation fixes into the same version rather
than splitting them into a separate tag.

### Added

- **Junction contract** — a multi-turn, structural-information-barrier engagement
  primitive that reveals one junction at a time. New public exports from
  `src/index.mjs`:
  - `runJunctionLoop`, `BAIL` (`src/lib/junction.mjs`) — the generic
    junction-graph + loop-runner that drives a hub-and-spoke or linear walk and
    lets a persona bail out early.
  - `ENGAGEMENT`, `REACTION_KEYS`, `TRACE_KEYS`, `deriveEngagement`,
    `normalizeEngagement`, `reactionFrom`, `buildTrace`, `aggregateJunctionTraces`
    (`src/lib/junction-schema.mjs`) — the generic reaction/decision schema,
    run-level trace builder, and cross-run aggregation. The engine emits
    mechanics; consumers own interpretation via `runJunctionLoop`'s `onComplete`
    hook.
- Junction contract documentation (`docs/junction-contract.md`) and two runnable
  examples (`examples/junction-branching.mjs`, `examples/junction-linear-chain.mjs`).

### Fixed

- Completed the internal-tracker leak sweep: removed the residual internal
  issue-tracker IDs and version codenames left in the README Status line and
  five source-file headers (`src/index.mjs`, `src/lib/register.mjs`,
  `src/lib/score.mjs`, `src/lib/honesty.mjs`, `src/lib/drift-check.mjs`).
  Comment/doc-only — no behaviour change. Public `panelist#N` references are
  preserved.
- Removed the obsolete internal `PORTING.md` port-plan doc (the port it
  described is complete; it leaked internal codenames and tracking IDs into
  this public repo).
- Pointed the README npm badge at the public npm package page instead of
  GitHub Packages, matching the public-npm install instructions.
- Documented that `publishConfig.registry` in `package.json` is intentionally
  pinned to GitHub Packages and is deliberately stripped by `release.yml`
  before the public-npm publish.

## [0.1.1] - 2026-07-20

Documentation-only patch release. No API or behavioural changes — this release
exists to ship the corrected public-facing docs to npm consumers, since README
content only reaches `npm i panelist` on a new publish (the docs fixes landed
in the repo after `0.1.0` was published).

- Fixed the README install instructions to match the live public-npm publish
  (`npm i panelist`), replacing the stale GitHub-Packages-only, token-gated
  install path that shipped in the `0.1.0` tarball.
- Added the hero illustration and the use-case / differentiator / "why"
  framing to the README.

## [0.1.0] - 2026-07-20

Initial extraction of panelist as a standalone library.

- Cross-model synthetic persona panel, built to counter same-model
  self-preference/sycophancy bias by default.
- Single-turn invocation contract (task/response envelope) decoupling
  persona identity from the task supplied at call time.
- Generic runner (`src/lib/runner.mjs`) that drives any registered persona
  by id for the agentic plane, with no per-persona agent files.
- v2 behavioural persona schema (`rewards` / `punishes` / `quitsWhen`) with
  an auto-stamped usage-honesty header on every panel output.
- Calibration harness for joining synthetic verdicts to real downstream
  signal and ranking personas by predictive accuracy rather than affect.
- Honesty guardrails and drift checking (`npm run drift`) to keep persona
  and schema records consistent.
- Example persona packs (`packs/review`, `packs/business`) shipped as
  illustrative rosters only.
