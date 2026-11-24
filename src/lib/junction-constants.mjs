// junction-constants.mjs — leaf module for constants shared between junction.mjs and
// junction-schema.mjs (panelist#89). Imports NOTHING from either of those modules, so
// both can depend on it without creating a cycle.

// Bail is always an available decision from every junction — the persona can quit
// anywhere. Reserved id: a graph must not name a junction "bail".
export const BAIL = "bail";

// Hard cap on turns in one walk (panelist#236) — a backstop independent of cost/budget.
// Override per run with opts.maxTurns; hitting it ends the walk with stopReason "max-turns".
export const DEFAULT_MAX_TURNS = 1000;
