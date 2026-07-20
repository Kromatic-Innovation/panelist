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
