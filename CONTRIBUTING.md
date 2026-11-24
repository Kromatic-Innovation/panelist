# Contributing to panelist

Thanks for your interest in improving panelist. This is a small, focused
library — please keep contributions scoped and traceable.

## Who maintains panelist

panelist is maintained by **Kromatic** (the
[Kromatic-Innovation](https://github.com/Kromatic-Innovation) GitHub
organization), which is the accountable party for this project. Contact paths:

- **Security vulnerabilities** — email `security@kromatic.com` privately. See
  [`SECURITY.md`](SECURITY.md) for what to include and the response times we
  commit to there.
- **Everything else** — the
  [issue tracker](https://github.com/Kromatic-Innovation/panelist/issues).

Be aware of how this project is actually run, so you can judge for yourself
whether to depend on it:

- Most commits here are authored by automation running under Kromatic's
  direction, not typed by hand. There is no dedicated review team, and we do
  **not** offer a response-time commitment on pull requests or feature
  requests. The response times in `SECURITY.md` cover security reports only.
- Accountability sits with the organization rather than a single named
  individual on purpose: `security@kromatic.com` is an organizational mailbox
  and Kromatic-Innovation organization owners retain admin on this repository,
  so neither contact path depends on one person remaining reachable.
- If Kromatic ever stops maintaining panelist, the project is Apache-2.0
  licensed and its full history is public — forking it is always available to
  you and needs no permission from us. We would rather say that plainly than
  imply a succession plan we have not staffed.

## Getting started

```bash
git clone https://github.com/Kromatic-Innovation/panelist.git
cd panelist
npm test          # node --test test/*.test.mjs
npm run drift     # src/lib/drift-check.mjs — checks persona/schema records for drift
```

panelist has zero runtime dependencies (`type: module`) and requires Node.js 22 or newer. There is no
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

panelist has exactly **one** publish path: the public npm registry, as the
unscoped package `panelist` on `https://registry.npmjs.org`, published by
`.github/workflows/release.yml` when a `v*` tag is pushed. There is no second
registry and no second publish workflow. To cut a release:

1. Bump `version` in `package.json` and `PANELIST_VERSION` in `src/index.mjs`
   to the same value — they must stay in sync.
2. Add a `CHANGELOG.md` entry for the new version under
   `## [X.Y.Z] - YYYY-MM-DD`, moving relevant `[Unreleased]` notes into it.
   Open the entry with a short **Highlights** list — 3-5 bullets naming the
   release's main storylines, written for someone deciding whether to upgrade —
   before the detailed `### Added` / `### Changed` / `### Fixed` / `### Docs`
   sections, so the shape of the release is legible without reading every
   bullet. Any release-wide behavior warning goes above the Highlights, in a
   banner directly under the version heading.

   **Flag every breaking change with a `### Breaking` section.** If the
   release changes anything a consumer can observe in a way their existing
   code may not survive (a removed or renamed export, a changed signature,
   return shape or default, a new required field, a different verdict or
   error for the same input), the entry must carry a `### Breaking` section,
   placed first among the detailed sections (before `### Added`). Give each
   bullet the interface that changed (the export, option or field by name),
   what it did before, what it does now, and what a caller must change. Keep
   the `**Breaking.**` banner under the version heading as well, so the
   release reads as breaking from its first line. Under the pre-1.0 rule
   (below) a breaking change ships as a MINOR bump; the `### Breaking`
   heading is how step 7 knows to run, so do not leave it out because the
   bump is "only" a minor.
3. Commit the bump on `develop` and merge it via PR as usual.
4. Promote `develop` → `main` (the `Promote Main` workflow,
   `.github/workflows/promote-main.yml`), so the release commit is on `main`.
5. Tag that commit `vX.Y.Z` **on `main`** and push the tag. Pushing a `v*` tag
   triggers `release.yml`, which publishes to public npm.
6. **After `release.yml` has finished publishing**, cut a GitHub Release for
   that same tag:

   ```bash
   gh release create vX.Y.Z --verify-tag \
     --title vX.Y.Z --notes-file <notes.md> --latest
   ```

   Take the notes from that version's own `CHANGELOG.md` section — the
   changelog is the authoritative record, so the Release should reproduce it
   rather than restate it. `--verify-tag` makes the command fail if the tag
   does not already exist, so a Release can only ever point at the tag step 5
   pushed; it never creates or moves one. Mark the newest version `--latest`;
   pass `--latest=false` when adding a Release for an older version after the
   fact.

   > **Before cutting a Release for an *older* tag, inspect that tag's own
   > tree.** A `release`-triggered workflow is resolved by GitHub from the
   > **release's tag ref**, not from the default branch — so deleting such a
   > workflow on `develop` does *not* disarm it for tags that predate the
   > deletion. Check with
   > `gh api /repos/Kromatic-Innovation/panelist/contents/.github/workflows?ref=vX.Y.Z`
   > before backfilling. This is not hypothetical: the panelist#163 backfill
   > cut Releases for `v0.2.0`, `v0.2.1` and `v0.3.0`, whose trees still
   > contain the `publish.yml` deleted in panelist#123, and all three ran it
   > and published `@kromatic-innovation/panelist` to GitHub Packages.

7. **If the new version's `CHANGELOG.md` entry has a `### Breaking` section,
   file one consumer-update issue in each consumer repo** — after
   `release.yml` has published the version to npm (step 5), never before, so
   every issue points at a version a consumer can actually install. Kromatic
   consumers do not pin panelist's version: they accept every upgrade, so a
   breaking change reaches them on their next lockfile bump whether or not
   they have been told. This step is how they are told.

   Each consumer issue must contain:

   - **the version** that introduces the break (`panelist X.Y.Z`), linking its
     GitHub Release and `CHANGELOG.md` section;
   - **the breaking change**, copied from the `### Breaking` bullets: what the
     behavior was and what it is now;
   - **the interface the consumer must update** — the panelist export, option
     or field by name — and where that consumer uses it (the manifest and the
     call sites the discovery search below turned up), with the change the
     consumer has to make.

   File the issues in the consumer repos, not here, and then link each one
   from the version's GitHub Release (`gh release edit vX.Y.Z --notes-file
   <notes.md>`, appending a "Consumer updates" list) so the public record
   shows the break was carried to every consumer. A consumer repo that is
   private should be linked as a fully qualified `owner/repo#N` reference in
   the Release notes only if naming it there is acceptable; otherwise record
   the count ("consumer-update issues filed in N repos") and keep the links
   in the private issues themselves.

   **Finding the consumers.** Most consumers are private repos, so this public
   file deliberately does not list them — a hand-kept list would also go
   stale. Run the discovery search at release time instead; it reflects the
   org's current code each time:

   ```bash
   # Direct dependents: every package.json in the org that mentions panelist,
   # at ANY depth — a consumer may declare it in a sub-directory package
   # (packages/*/package.json, apps/*/package.json, tools/*/package.json), not
   # only at its root. The filename qualifier matches nested paths too. Pass
   # the term bare: gh quotes it itself, and adding quotes breaks the query.
   gh search code --owner Kromatic-Innovation panelist \
     --filename package.json --json repository,path \
     --jq '.[] | "\(.repository.nameWithOwner)  \(.path)"' | sort -u

   # Transitive dependents: repos whose LOCKFILE resolves panelist even though
   # no package.json of theirs names it — they receive it through another
   # Kromatic package.
   for f in package-lock.json pnpm-lock.yaml yarn.lock; do
     gh search code --owner Kromatic-Innovation panelist \
       --filename "$f" --json repository,path \
       --jq '.[] | "\(.repository.nameWithOwner)  \(.path)"'
   done | sort -u
   ```

   Then follow **git-tag consumers** one hop further. A Kromatic package that
   depends on panelist and is itself installed by git tag
   (`"github:Kromatic-Innovation/<pkg>#vX.Y.Z"` or
   `git+https://github.com/Kromatic-Innovation/<pkg>.git#vX.Y.Z`) passes
   panelist on to its own consumers, and a lockfile search can miss them,
   because a git dependency's lock entry may not name panelist at all. For
   each package the first search found, search for repos that install that
   package from git:

   ```bash
   gh search code --owner Kromatic-Innovation 'Kromatic-Innovation/<pkg>' \
     --filename package.json --json repository,path \
     --jq '.[] | "\(.repository.nameWithOwner)  \(.path)"' | sort -u
   ```

   Repeat until a hop finds no new repos. A transitive consumer gets an issue
   only if it calls the changed interface itself. If it only receives
   panelist through the intermediate package, the issue goes to that
   package's repo, which then cuts its own release. GitHub code search
   indexes only each repo's default branch, so a consumer that declares
   panelist only on a feature branch will not show up. Treat the result as
   the consumer list at release time, not as a guarantee nothing else
   exists. Run the searches with credentials that can read the org's private
   repos, or they will return only the public ones.

**The tag must be on `main`.** `release.yml` fires from a `v*` tag pushed from
any ref, so it defends itself: it hard-fails the job if the tagged commit is
not an ancestor of `origin/main` (`git merge-base --is-ancestor "$GITHUB_SHA"
origin/main`). Tag before promoting and the publish is rejected, not silently
released from unmerged code.

**Step 6 is a release-notes / public-record step, performed after the publish —
it is *not* a publish trigger.** Nothing runs on `release: published` any more;
the pushed tag is what publishes. The Release exists so the GitHub side of the
record (notes, an audit trail, a subscribe/notify surface) lines up with npm's
version history for anyone checking provenance. Cutting it earlier would
publish nothing; skipping it publishes just the same, and only leaves the
public record thinner.

That claim is about the *current* flow — a tag just pushed from `main`, whose
tree contains no `release`-triggered workflow. It is **not** a general claim
that cutting a Release can never run anything: see the caveat under step 6 for
older tags.

Releases for the tags that predate this step (`v0.2.0`, `v0.2.1`, `v0.3.0`,
`v0.4.0`) were backfilled in panelist#163, so the Releases page is complete
rather than prospective.

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
secrets — that tag push is the workflow's only trigger. See
`.github/workflows/release.yml` for the authoritative auth model.
