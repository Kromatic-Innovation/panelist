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

### Security

- **An untrusted artifact could break out of its `"""` fence and inject
  content into the prompt (#82).** All three prompt builders
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

- **The honesty caveat is now auto-stamped on every public output surface,
  not just some of them (#81).** An audit found 8 public surfaces that did
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

- **A total panel failure no longer returns a passing verdict (#80).** When
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

## [0.3.0] - 2026-07-28

**Breaking.** Bumped as a MINOR under pre-1.0 semantics (see above) because it
changes default behavior for existing callers of `spawn`/`runPersona`.

### Changed

- **Persona tool isolation is now deny-by-default (#72).** Previously, a
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
- **The multi-turn junction plane is now gated too (#75).** `runJunctionLoop`
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
  (#77).** `scoreCandidate`/`score` accepted `deps.tools` and reported it in
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
  any artifact (#73): the opening use-case paragraph, the use-cases list (now
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
cross-repo reusable workflow was **withdrawn** (#59, PR #62): a public repo
cannot call a reusable workflow hosted in a private one, so it could never
execute. The shared-template goal moves to a sync-and-drift-check model
(code-workspace-config#1559), leaving this repo's working inline workflow in
place.

## [0.2.0] - 2026-07-21

New MINOR release (pre-1.0 semantics — see above): the multi-turn **junction
contract** subsystem landed as a new public feature across #46/#47/#48, so this
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
