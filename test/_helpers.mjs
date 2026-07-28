// Shared offline test doubles. NOT a test file (won't match *.test.mjs), so
// node --test ignores it. No network, no secrets.

/**
 * A mock client/panelist. `respond(prompt)` returns the model's raw text.
 * @param {string} model
 * @param {(prompt: string) => string} respond
 */
export function mockClient(model, respond) {
  return {
    model,
    async complete({ prompt }) {
      return { ok: true, text: respond(prompt), model };
    },
  };
}

/** A client whose complete() always fails (simulates a dead provider). */
export function deadClient(model = "dead") {
  return {
    model,
    async complete() {
      return { ok: false, reason: "simulated failure" };
    },
  };
}

/** A panelist that returns fixed axis scores as JSON. */
export function fixedScorer(model, scores) {
  return mockClient(model, () => JSON.stringify({ ...scores, note: "mock" }));
}

/** A spawn client that returns a fixed wrapper payload as JSON. */
export function fixedSpawn(model, payload) {
  return mockClient(model, () => JSON.stringify(payload));
}

/**
 * A spawn client that ACTUALLY consults the `tools` allowlist it's called
 * with (panelist#72): if `toolId` is in the granted set, it "calls" it (no-op
 * here, just reflects success in the payload); if not, it reports the attempt
 * via `res.deniedToolCalls` instead of silently proceeding — exercising the
 * real gate contract rather than a hardcoded denial.
 * @param {string} model
 * @param {string} toolId  the tool this persona will always try to reach for
 * @param {object} payload  the wrapper payload to emit (message/dealKillers/verdict)
 */
export function toolAttemptingClient(model, toolId, payload) {
  return {
    model,
    async complete({ tools }) {
      const granted = Array.isArray(tools) && tools.includes(toolId);
      return {
        ok: true,
        text: JSON.stringify(payload),
        model,
        deniedToolCalls: granted ? [] : [toolId],
      };
    },
  };
}

/**
 * A scorer panelist (score.mjs shape) that ACTUALLY consults the `tools`
 * allowlist it's called with (panelist#72/#77) — the scorer-shaped sibling of
 * toolAttemptingClient above. If `toolId` is in the granted set it "calls" it
 * (no-op, reflected as no denial); if not, it reports the attempt via
 * `res.deniedToolCalls` instead of silently proceeding.
 * @param {string} model
 * @param {string} toolId  the tool this panelist will always try to reach for
 * @param {object} scores  fixed axis scores to emit
 */
export function toolAttemptingScorer(model, toolId, scores) {
  return {
    model,
    async complete({ tools }) {
      const granted = Array.isArray(tools) && tools.includes(toolId);
      return {
        ok: true,
        text: JSON.stringify({ ...scores, note: "mock" }),
        model,
        deniedToolCalls: granted ? [] : [toolId],
      };
    },
  };
}

/** A panelist (score.mjs shape) that captures the raw args every complete() call receives. */
export function capturingScorer(model, scores, captured) {
  return {
    model,
    async complete(args) {
      captured.push(args);
      return { ok: true, text: JSON.stringify({ ...scores, note: "mock" }), model };
    },
  };
}
