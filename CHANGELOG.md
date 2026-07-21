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
