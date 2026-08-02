# Contributing to panelist

Thanks for your interest in improving panelist. This is a small, focused
library — please keep contributions scoped and traceable.

## Getting started

```bash
git clone https://github.com/Kromatic-Innovation/panelist.git
cd panelist
npm test          # node --test test/*.test.mjs
npm run drift     # src/lib/drift-check.mjs — checks persona/schema records for drift
```

panelist has zero runtime dependencies (`type: module`, Node >=20). There is no
build step; `npm test` and `npm run drift` are the two commands CI runs.

## Branch and PR conventions

- Base your branch on `develop` and open PRs **against `develop`** — not `main`.
  `main` is promoted from `develop` deliberately via the `Promote Main` workflow
  and should not receive direct PRs.
- One issue, one PR where practical. Reference the issue you're addressing
  (e.g. `Fixes #NNN`) so scope is traceable.
- Keep PRs scoped to the linked issue. Drive-by refactors, prose rewrites, or
  unrelated cleanup belong in a separate PR.
- CI (`.github/workflows/ci.yml`) must pass: tests green, no drift.

## Scope discipline

panelist is intentionally small. Before adding a feature, check whether it
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

panelist publishes to two registries: GitHub Packages on a GitHub Release
(`.github/workflows/publish.yml`, internal/org consumers) and public npm on
a version tag (`.github/workflows/release.yml`, `panelist`
on `https://registry.npmjs.org`). To cut a release:

1. Bump `version` in `package.json` and `PANELIST_VERSION` in `src/index.mjs`
   to the same value — they must stay in sync.
2. Add a `CHANGELOG.md` entry for the new version under
   `## [X.Y.Z] - YYYY-MM-DD`, moving relevant `[Unreleased]` notes into it.
3. Commit, then tag the release commit `vX.Y.Z` and push the tag. Pushing a
   `v*` tag triggers `release.yml`, which publishes to public npm.
4. Cut a corresponding GitHub Release for the tag, which triggers
   `publish.yml` for the GitHub Packages side.

**Pre-1.0 (0.x) semver rule:** while panelist is `0.x`, MINOR bumps (`0.x.0`)
may include breaking changes and PATCH bumps (`0.0.x`) are for fixes only —
see `CHANGELOG.md` for the same rule stated for consumers.

**Publish auth is npm Trusted Publishing (OIDC) — there is no `NPM_TOKEN`
secret.** `release.yml` mints a short-lived OIDC token at publish time
(`id-token: write`), so no long-lived credential is stored anywhere. The one
manual step is the *bootstrap*: npm can only attach a Trusted Publisher to a
package that already exists, so the **first** publish for the package had to be
a manual `npm publish` from a maintainer's logged-in machine. Every release
after that runs through `release.yml` on a pushed `v*` tag with zero stored
secrets. A `workflow_dispatch` dry run is available at any time for validating
the pipeline without cutting a release. See `.github/workflows/release.yml` for
the authoritative auth model.

**Why `package.json`'s checked-in `publishConfig.registry` points at GitHub
Packages.** This is intentional, not stale: `publish.yml` (internal/org side)
relies on the checked-in `publishConfig.registry` pointing at
`npm.pkg.github.com` to publish there. For the public-npm side, `release.yml`
deliberately runs `npm pkg delete publishConfig.registry` before publishing,
stripping it in-CI so that publish routes to the default `registry.npmjs.org`
instead. So if you're reading `package.json` cold and wondering why it's
pinned to GitHub Packages when consumers install from public npm — that's
why: the pin is for one workflow, and the other workflow removes it before it
ever reaches npmjs.org.
