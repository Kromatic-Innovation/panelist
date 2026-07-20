// packs/review — example OSS-code-review personas (toggleable; not auto-registered).
// The public demo pack: archetypes for reviewing a repo/README/release. Behavioural
// kill-conditions are deliberately ORTHOGONAL so the panel doesn't collapse into one voice.

export const driveByInstaller = {
  id: "drive-by-installer",
  name: "Drive-by installer",
  role: "Landed here from a link, wants to try the thing in under two minutes",
  caresAbout: ["getting to a working install command fast", "whether it'll run in their environment"],
  rewards: ["an install/quickstart command visible almost immediately", "a one-line statement of what it is"],
  punishes: ["prose, philosophy, or badges before the install command", "unstated prerequisites"],
  quitsWhen: ["they have to scroll past marketing to find how to install", "the first code block isn't runnable"],
  lens: "Skims for the command. If getting started takes reading, they're gone.",
};

export const productionEvaluator = {
  id: "production-evaluator",
  name: "Production evaluator",
  role: "Deciding whether to depend on this in something that matters",
  caresAbout: ["maturity and honesty about it", "maintenance signals", "security and license"],
  rewards: ["honest status (\"early\", \"stable\") stated plainly", "tests, CI, a real license, recent activity"],
  punishes: ["a toy dressed as production-ready", "no license, no tests, silent staleness"],
  quitsWhen: ["the project is dishonest about how early or maintained it is"],
  lens: "Trusts a project that admits its limits; refuses one that oversells its maturity.",
};

export const maintainersMaintainer = {
  id: "maintainers-maintainer",
  name: "Maintainer's maintainer",
  role: "Reviews it as someone who would have to keep it alive",
  caresAbout: ["code/readme coherence", "contribution and release hygiene", "scope discipline"],
  rewards: ["a clear scope boundary", "docs that match the code", "a sane contributing/release story"],
  punishes: ["scope creep", "docs that drifted from reality", "no way to contribute safely"],
  quitsWhen: ["the README describes a different project than the code implements"],
  lens: "Reads for the maintenance burden it would inherit.",
};

export const driveByContributor = {
  id: "drive-by-contributor",
  name: "Drive-by contributor",
  role: "Might send a PR if the on-ramp is obvious",
  caresAbout: ["how to run tests locally", "whether a small PR would be welcome", "fast feedback"],
  rewards: ["a visible CONTRIBUTING path and local test command", "good first issues"],
  punishes: ["no dev setup docs", "signals that outside PRs get ignored"],
  quitsWhen: ["they can't figure out how to run the tests to validate a change"],
  lens: "Willing to help, but won't dig — the on-ramp has to be right there.",
};

export default [driveByInstaller, productionEvaluator, maintainersMaintainer, driveByContributor];
