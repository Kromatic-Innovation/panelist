# Contributing to plenum

Thanks for your interest in improving plenum. This is a small, focused
library — please keep contributions scoped and traceable.

## Getting started

```bash
git clone https://github.com/Kromatic-Innovation/plenum.git
cd plenum
npm test          # node --test test/*.test.mjs
npm run drift     # src/lib/drift-check.mjs — checks persona/schema records for drift
```

plenum has zero runtime dependencies (`type: module`, Node >=20). There is no
build step; `npm test` and `npm run drift` are the two commands CI runs.

## Branch and PR conventions

- Base your branch on `develop` and open PRs **against `develop`** — not `main`.
  `main` is promoted from `develop` deliberately via the `Promote Main` workflow
  and should not receive direct PRs.
- One issue, one PR where practical. Reference the issue you're addressing
  (e.g. `Fixes #12`) so scope is traceable.
- Keep PRs scoped to the linked issue. Drive-by refactors, prose rewrites, or
  unrelated cleanup belong in a separate PR.
- CI (`.github/workflows/ci.yml`) must pass: tests green, no drift.

## Scope discipline

plenum is intentionally small. Before adding a feature, check whether it
belongs in this library at all:

- Core behavior (persona identity, task envelope, scoring, honesty stamping,
  drift checking) lives in `src/`.
- Example persona rosters live in `packs/` (`packs/review`, `packs/business`)
  and are illustrative only — real, private persona rosters belong in the
  consuming repo, not here.
- If you're adding a new capability rather than fixing or extending an
  existing one, open an issue first to discuss it before sending a PR.

## Personas are behavioral, not demographic

This is a hard rule, not a style preference: persona identity is defined by
what a persona **rewards**, **punishes**, and **quits when** — never by age,
employer, tenure, or other demographic attributes. If a PR adds or modifies a
persona (in `packs/` or elsewhere), it will be rejected if it encodes
demographic traits instead of behavioral kill-conditions. See
[`docs/synthetic-persona-best-practices.md`](docs/synthetic-persona-best-practices.md)
for the full rationale.

## Tests

Add or update tests under `test/` for any behavior change. Tests run via the
built-in Node test runner (`node --test test/*.test.mjs`) — no external test
framework.

## Reporting bugs or requesting features

Use the issue templates under `.github/ISSUE_TEMPLATE/`. For security
vulnerabilities, see [`SECURITY.md`](SECURITY.md) instead of filing a public
issue.

## Releasing

plenum publishes to two registries: GitHub Packages on a GitHub Release
(`.github/workflows/publish.yml`, internal/org consumers) and public npm on
a version tag (`.github/workflows/release.yml`, `@kromatic-innovation/plenum`
on `https://registry.npmjs.org`). To cut a release:

1. Bump `version` in `package.json` and `PLENUM_VERSION` in `src/index.mjs`
   to the same value — they must stay in sync.
2. Add a `CHANGELOG.md` entry for the new version under
   `## [X.Y.Z] - YYYY-MM-DD`, moving relevant `[Unreleased]` notes into it.
3. Commit, then tag the release commit `vX.Y.Z` and push the tag. Pushing a
   `v*` tag triggers `release.yml`, which publishes to public npm.
4. Cut a corresponding GitHub Release for the tag, which triggers
   `publish.yml` for the GitHub Packages side.

**Pre-1.0 (0.x) semver rule:** while plenum is `0.x`, MINOR bumps (`0.x.0`)
may include breaking changes and PATCH bumps (`0.0.x`) are for fixes only —
see `CHANGELOG.md` for the same rule stated for consumers.

**Before the first public-npm publish:** an `NPM_TOKEN` secret (a
human-provisioned npm automation token with publish rights for
`@kromatic-innovation`) must be added in repo settings, or `release.yml`
will fail at the real-publish step. Until then, `workflow_dispatch` dry runs
are safe to use for validating the pipeline.
