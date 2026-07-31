import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { renderRunnerPrompt, runPersona } from "../src/lib/runner.mjs";
import { registerPersonas, clearRegistry } from "../src/lib/register.mjs";
import { fixedSpawn } from "./_helpers.mjs";
import reviewPack from "../packs/review/index.mjs";

const artifact = "# My Project\nInstall: `npm i my-project`";
const VOTE_SCHEMA = { type: "object", properties: { decision: { enum: ["approve", "reject"] } } };

beforeEach(() => {
  clearRegistry();
  registerPersonas(reviewPack);
});

test("renderRunnerPrompt includes the persona's identity and the task's artifact/instruction", () => {
  const prompt = renderRunnerPrompt("drive-by-installer", {
    mode: "vote",
    artifact,
    instruction: "Would you stop reading before the install command?",
  });
  assert.match(prompt, /Drive-by installer/);
  assert.match(prompt, /getting to a working install command fast/); // a rewards/caresAbout line
  assert.match(prompt, /npm i my-project/); // artifact
  assert.match(prompt, /Would you stop reading before the install command\?/); // instruction
});

test("renderRunnerPrompt throws on an unknown persona id", () => {
  assert.throws(
    () => renderRunnerPrompt("no-such-persona", { mode: "comment", artifact }),
    /unknown persona/,
  );
});

test("one runner renders MULTIPLE different registered personas generically (D5)", () => {
  const installerPrompt = renderRunnerPrompt("drive-by-installer", { mode: "comment", artifact });
  const evaluatorPrompt = renderRunnerPrompt("production-evaluator", { mode: "comment", artifact });

  assert.match(installerPrompt, /Drive-by installer/);
  assert.match(installerPrompt, /getting to a working install command fast/);
  assert.match(evaluatorPrompt, /Production evaluator/);
  assert.match(evaluatorPrompt, /maturity and honesty about it/);
  assert.notEqual(installerPrompt, evaluatorPrompt);
});

test("one runner runs MULTIPLE different registered personas generically (D5)", async () => {
  const client = fixedSpawn("claude-x", { message: "reacting", dealKillers: [] });

  const installerOut = await runPersona("drive-by-installer", { mode: "comment", artifact }, { client });
  const evaluatorOut = await runPersona("production-evaluator", { mode: "comment", artifact }, { client });

  assert.equal(installerOut.personaId, "drive-by-installer");
  assert.equal(evaluatorOut.personaId, "production-evaluator");
});

test("runPersona with an injected mock client returns the contract wrapper: verdict filled iff responseSchema is passed", async () => {
  const clientWithSchema = fixedSpawn("claude-x", {
    verdict: { decision: "approve" },
    message: "Install command is right up top.",
    dealKillers: [],
  });
  const withSchema = await runPersona(
    "drive-by-installer",
    { mode: "vote", artifact, responseSchema: VOTE_SCHEMA },
    { client: clientWithSchema },
  );
  assert.equal(withSchema.personaId, "drive-by-installer");
  assert.equal(withSchema.mode, "vote");
  assert.deepEqual(withSchema.verdict, { decision: "approve" });
  assert.ok(Array.isArray(withSchema.dealKillers));

  const clientNoSchema = fixedSpawn("claude-x", {
    verdict: { decision: "approve" }, // model may still emit one; must be ignored
    message: "Looks fine.",
    dealKillers: [],
  });
  const noSchema = await runPersona(
    "drive-by-installer",
    { mode: "vote", artifact },
    { client: clientNoSchema },
  );
  assert.equal(noSchema.verdict, null);
  assert.ok(Array.isArray(noSchema.dealKillers));
});

test("runPersona rejects an unknown persona (delegated to spawn)", async () => {
  const client = fixedSpawn("claude-x", { message: "hi", dealKillers: [] });
  await assert.rejects(
    () => runPersona("no-such-persona", { mode: "comment", artifact }, { client }),
    /unknown persona/,
  );
});

test("runPersona isolation (panelist#72): defaults to no tools, honors an explicit allowlist (delegated to spawn)", async () => {
  const client = fixedSpawn("claude-x", { message: "reacting", dealKillers: [] });

  const defaultOut = await runPersona("drive-by-installer", { mode: "comment", artifact }, { client });
  assert.deepEqual(defaultOut.isolation, { tools: [], denied: [] });

  const grantedOut = await runPersona(
    "drive-by-installer",
    { mode: "comment", artifact, tools: ["recall"] },
    { client },
  );
  assert.deepEqual(grantedOut.isolation, { tools: ["recall"], denied: [] });
});

// ── panelist#113: per-call model pass-through ───────────────────────────────

function capturingClient(model, payload, captured) {
  return {
    model,
    async complete(args) {
      captured.push(args);
      return { ok: true, text: JSON.stringify(payload), model };
    },
  };
}

test("runPersona forwards task.model to client.complete (delegated to spawn)", async () => {
  const captured = [];
  const client = capturingClient("claude-x", { message: "reacting", dealKillers: [] }, captured);
  await runPersona("drive-by-installer", { mode: "comment", artifact, model: "claude-haiku-4-5" }, { client });
  assert.equal(captured.length, 1);
  assert.equal(captured[0].model, "claude-haiku-4-5");

  // ...and omits the key when task.model is absent (adapter default is used).
  const captured2 = [];
  const client2 = capturingClient("claude-x", { message: "reacting", dealKillers: [] }, captured2);
  await runPersona("drive-by-installer", { mode: "comment", artifact }, { client: client2 });
  assert.equal("model" in captured2[0], false);
});

test("renderRunnerPrompt output is byte-identical with and without task.model", () => {
  const without = renderRunnerPrompt("drive-by-installer", { mode: "vote", artifact, instruction: "React." });
  const with_ = renderRunnerPrompt("drive-by-installer", { mode: "vote", artifact, instruction: "React.", model: "claude-haiku-4-5" });
  assert.equal(with_, without); // model is execution-shaping, not prompt-shaping (panelist#113)
});
