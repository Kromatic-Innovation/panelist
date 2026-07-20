# Synthetic persona best practices

> This is the governing reference for the plenum persona system. Downstream slices
> (persona schema, packs, scoring, calibration) cite this doc rather than re-deriving
> these rules. If a slice's design conflicts with something here, fix the slice or
> propose an edit to this doc — don't silently diverge.

## 1. Specificity over decoration

Keep whatever changes behaviour under the artifact: what a persona rewards, what it
punishes, what it quits over, the decision actually at stake. Drop everything else —
age, employer, job title, tenure, hobbies. None of it predicts a kill.

Decoration is worse than useless: it's spurious precision. "42-year-old VP of
Engineering at a Series B startup" *reads* like a well-researched persona and makes
the verdict feel more authoritative, but nothing in that sentence changes whether
they'd bounce off a wall of prose before the install command. Adding detail that
doesn't drive behaviour buys false confidence, not fidelity. If a fact can be deleted
from a persona record without changing a single verdict, it shouldn't be in the record.

Test: for every field on a persona, ask "does an LLM playing this role behave
differently with this field present vs. absent?" If no, cut it.

## 2. Demographics vs. behaviour

Only the behavioural lens does real work. `rewards` / `punishes` / `quitsWhen` are
the load-bearing fields — they're the whole reason the persona produces a
differentiated verdict instead of a generic one. Demographic tags (age, gender,
income bracket, "busy parent," "millennial") don't add predictive power; they add
two failure modes instead:

- **Persona collapse.** Give a model a demographic label and it reaches for the
  cultural average of that label — five "millennial" personas converge on the same
  voice, because the model is pattern-matching on the tag, not reasoning about a
  distinct kill-condition.
- **Stereotype over-focus.** Demographic framing invites the model to perform the
  stereotype rather than the behaviour, which is a worse simulation, not a richer one.

The fix is mechanical: state the habit, drop the proxy. Not "a busy parent won't read
long emails" — `quitsWhen: ["the second paragraph starts before the ask is stated"]`.
The habit is portable and testable; the demographic is a label that happens to
correlate with it in some cases and not others.

## 3. Anti-sycophancy

Score behaviour, not affect. A verdict built around warmth ("how much would they
like this?") is an invitation for the model — and the reader of the verdict — to
mistake enthusiasm for validity. plenum's default output is a **deal-killer /
cut-list**: where would this reader stop, dismiss, or refuse to forward? Abandonment
is a behavioural event; it's far more robustly simulable than affect, and it doesn't
grade on a curve the way a 1-10 "would you like this" score does.

Controls that keep this honest in practice:

- **Deal-killers over scores.** The default artifact is a list of kill points, not a
  rating. A cut-list can be wrong; it can't be flattered.
- **Cross-model panels, ≥2 providers.** Same-model self-preference is real — a model
  scoring its own output (or output styled the way it likes) is a sycophancy vector
  by construction. ≥2 providers is the minimum panel size that catches it.
- **Kill-floors.** A panel that never produces a kill isn't diverse, it's agreeing
  with itself. If zero personas quit on a draft that a human reviewer would flag,
  treat that as a panel failure, not a clean bill of health.
- **Adversarial framing.** Ask "where would you quit" and "what would make you
  refuse to forward this," not "what do you think" — the instruction shape itself
  determines whether the model reaches for praise or for a specific failure point.

## 4. Panel diversity

Personas should differentiate on kill-condition, not identity. Two personas with
different names and different demographic dressing but the same `quitsWhen` are one
persona wearing a costume — they'll produce correlated verdicts and the panel will
feel diverse while doing the work of one voice.

- **Differentiate on kill-conditions.** Each persona in a panel should own a
  materially different failure mode (see `packs/review`: install friction vs.
  maturity dishonesty vs. docs/code drift vs. contribution on-ramp — four distinct,
  orthogonal quits, zero demographic framing).
- **Stratified variance injection.** Where you want spread within a single archetype
  (not across archetypes), inject variance on the behavioural axis — different
  thresholds for the same kill-condition, different weighting of `caresAbout` — not
  on invented biography. This is the variance engine's job: stratify the dimension
  that actually drives disagreement, not the one that's easy to enumerate.
- **"Asking for diversity" doesn't work.** Prompting a model with "give me 5 diverse
  perspectives" reliably produces 5 restatements of the mode with cosmetic variation.
  Diversity has to be engineered into the persona records and the panel composition
  up front — it is not a property you can request at generation time.

## 5. Calibration

A synthetic verdict is a hypothesis, not a fact, until it's checked against reality.
Calibration is the deferred step that closes the loop: join synthetic verdicts to
real downstream signal (GA4 events, BigQuery conversion/bounce/forward data — whatever
the artifact's real-world outcome is) and see whether the panel's kills actually
predicted drop-off.

- **Join, don't just log.** A verdict that's never checked against an outcome is
  unfalsifiable by design. Store enough to join a persona's cut-list against the
  artifact's real performance later.
- **Report rank-correlation, not accuracy theater.** The useful question isn't "was
  the panel right" (right about what — a score has no ground truth) but "did the
  panel's ranking of drafts correlate with the ranking real readers produced?" Report
  a rank-correlation figure, and report it even when it's weak — a panel that doesn't
  correlate with downstream signal yet is calibration debt, not a bug to hide.
- **Calibration is deferred, not skipped.** It's fine to ship a panel before the
  calibration join exists — that's the honest state of "drafting aid, not yet
  validated." It stops being fine if the panel starts being *described* as validated
  before that join runs. Track deferred calibration explicitly rather than letting it
  quietly become an implicit claim.

## 6. The honesty line

**This is the section that matters most. If you only take one rule from this
document, take this one.**

Synthetic personas are a drafting aid and a cheap pre-filter. They are not evidence
about real users. They are not user research. They are not validation. A panel of
LLM-played personas agreeing that a draft is good tells you the draft cleared a cheap,
useful, and fundamentally synthetic bar — it does not tell you a real reader will
behave the same way. "Our personas responded well to this" is a sentence this system
exists to make hard to write, and this doc exists to make hard to forget.

This is not a new stance invented for this doc — it's the same line the plenum
README draws (`⚠️ What plenum is and is not for`), restated here so every downstream
slice inherits it without re-deriving it:

- Legitimate uses: drafting aid, cut obviously-weak drafts before spending a human's
  attention, catch obvious misses.
- Illegitimate uses: evidence about real readers, a substitute for talking to them,
  validation, a way to greenlight a decision that should wait on real signal.

Practical rules that keep honest use easy and dishonest use awkward:

- **Auto-stamp the caveat.** Every panel output carries the "this is not user
  research" caveat by construction, not as an opt-in flag someone can forget to set.
  Making the honest framing the default (rather than an add-on) is what makes
  dishonest use require active effort instead of just silence.
- **Deal-killers over scores, again.** A cut-list is much harder to launder into "the
  AI validated this" than a score is. Scores are the vector for misuse; keep them out
  of the default output.
- **Never let "calibrated" mean "validated."** Even after a calibration join exists
  and produces a real rank-correlation number, that number describes *predictive
  usefulness of a cheap filter*, not equivalence to real user research. Don't let a
  good correlation figure get quietly reframed as "so we don't need real users."
  Calibration makes the pre-filter cheaper to trust; it doesn't promote it out of
  pre-filter status.
- **When in doubt, name the tool's limit out loud.** If a downstream slice's docs,
  UI, or output could plausibly be read as "the AI approved this for real users,"
  that's a bug in the slice, not an acceptable interpretation — fix the framing before
  shipping.
