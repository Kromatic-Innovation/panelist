import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "../src/lib/spawn.mjs";
import { registerPersonas, clearRegistry } from "../src/lib/register.mjs";
import { fixedSpawn, mockClient, toolAttemptingClient } from "./_helpers.mjs";
import reviewPack from "../packs/review/index.mjs";

const artifact = "# My Project\nInstall: `npm i my-project`";
const VOTE_SCHEMA = { type: "object", properties: { decision: { enum: ["approve", "reject"] } } };

beforeEach(() => {
  clearRegistry();
  registerPersonas(reviewPack);
});

test("vote with a responseSchema fills verdict and returns a well-formed wrapper", async () => {
  const client = fixedSpawn("claude-x", {
    verdict: { decision: "approve" },
    message: "Install command is right up top — I can try it.",
    dealKillers: [],
  });
  const out = await spawn("drive-by-installer", { mode: "vote", artifact, instruction: "Would you try it?", responseSchema: VOTE_SCHEMA }, { client });
  // honesty is auto-stamped on the wrapper (panelist#81).
  assert.deepEqual(Object.keys(out).sort(), ["dealKillers", "honesty", "isolation", "message", "mode", "personaId", "verdict"]);
  assert.equal(out.personaId, "drive-by-installer");
  assert.equal(out.mode, "vote");
  assert.deepEqual(out.verdict, { decision: "approve" });
  assert.equal(typeof out.message, "string");
  assert.ok(Array.isArray(out.dealKillers));
});

test("verdict stays null without a responseSchema, even if the model emits one", async () => {
  const client = fixedSpawn("claude-x", { verdict: { decision: "approve" }, message: "Looks fine.", dealKillers: [] });
  const out = await spawn("drive-by-installer", { mode: "comment", artifact }, { client });
  assert.equal(out.verdict, null);
  assert.equal(out.mode, "comment");
  assert.ok(out.message.length > 0);
});

test("dealKillers are always an array and are surfaced", async () => {
  const client = fixedSpawn("gpt-y", { message: "Prose before the install line.", dealKillers: ["marketing precedes the install command"] });
  const out = await spawn("drive-by-installer", { mode: "converse", artifact }, { client });
  assert.deepEqual(out.dealKillers, ["marketing precedes the install command"]);
  assert.equal(out.verdict, null);
});

test("message falls back to raw text when the model omits a message field", async () => {
  const client = mockClient("claude-x", () => "just some plain text, no json");
  const out = await spawn("drive-by-installer", { mode: "comment", artifact }, { client });
  assert.equal(out.message, "just some plain text, no json");
  assert.deepEqual(out.dealKillers, []);
});

test("the default client throws — a live provider must be injected", async () => {
  await assert.rejects(() => spawn("drive-by-installer", { mode: "comment", artifact }), /inject a client/);
});

test("spawn rejects an unknown persona and a bad mode", async () => {
  const client = fixedSpawn("claude-x", { message: "hi", dealKillers: [] });
  await assert.rejects(() => spawn("no-such-persona", { mode: "comment", artifact }, { client }), /unknown persona/);
  await assert.rejects(() => spawn("drive-by-installer", { mode: "bogus", artifact }, { client }), /mode must be one of/);
});

// ── Tool isolation (panelist#72) ──────────────────────────────────────────

test("default → denied: spawn grants no tools when opts.tools is omitted", async () => {
  const client = fixedSpawn("claude-x", { message: "reacting", dealKillers: [] });
  const out = await spawn("drive-by-installer", { mode: "comment", artifact }, { client });
  assert.deepEqual(out.isolation, { tools: [], denied: [] });
});

test("explicit allowlist → permitted: opts.tools grants exactly the named tools", async () => {
  const client = fixedSpawn("claude-x", { message: "reacting", dealKillers: [] });
  const out = await spawn("drive-by-installer", { mode: "comment", artifact, tools: ["recall"] }, { client });
  assert.deepEqual(out.isolation, { tools: ["recall"], denied: [] });
});

test("a wildcard tool grant throws rather than silently opening everything", async () => {
  const client = fixedSpawn("claude-x", { message: "reacting", dealKillers: [] });
  await assert.rejects(
    () => spawn("drive-by-installer", { mode: "comment", artifact, tools: "*" }, { client }),
    /wildcard/,
  );
});

test("an attempted-but-denied tool call surfaces in isolation.denied, not swallowed", async () => {
  const client = toolAttemptingClient("claude-x", "recall", { message: "reacting", dealKillers: [] });
  const out = await spawn("drive-by-installer", { mode: "comment", artifact }, { client });
  assert.deepEqual(out.isolation.tools, []);
  assert.equal(out.isolation.denied.length, 1);
  assert.equal(out.isolation.denied[0].tool, "recall");
  assert.equal(out.isolation.denied[0].reviewer, "drive-by-installer");
  assert.match(out.isolation.denied[0].at, /^\d{4}-\d{2}-\d{2}T/);
});

test("granting the attempted tool clears the denial (the same client, now permitted)", async () => {
  const client = toolAttemptingClient("claude-x", "recall", { message: "reacting", dealKillers: [] });
  const out = await spawn("drive-by-installer", { mode: "comment", artifact, tools: ["recall"] }, { client });
  assert.deepEqual(out.isolation, { tools: ["recall"], denied: [] });
});

// ── PAN-09: injectable maxTokens/temperature (panelist#85) ──────────────────

function capturingClient(model, payload, captured) {
  return {
    model,
    async complete(args) {
      captured.push(args);
      return { ok: true, text: JSON.stringify(payload), model };
    },
  };
}

test("spawn forwards default maxTokens (1024) and temperature (0) when deps omits them", async () => {
  const captured = [];
  const client = capturingClient("claude-x", { message: "reacting", dealKillers: [] }, captured);
  await spawn("drive-by-installer", { mode: "comment", artifact }, { client });
  assert.equal(captured.length, 1);
  assert.equal(captured[0].maxTokens, 1024);
  assert.equal(captured[0].temperature, 0);
});

test("spawn forwards deps.maxTokens/deps.temperature when supplied", async () => {
  const captured = [];
  const client = capturingClient("claude-x", { message: "reacting", dealKillers: [] }, captured);
  await spawn("drive-by-installer", { mode: "comment", artifact }, { client, maxTokens: 256, temperature: 0.9 });
  assert.equal(captured.length, 1);
  assert.equal(captured[0].maxTokens, 256);
  assert.equal(captured[0].temperature, 0.9);
});

test("spawn honors an explicit temperature of 0 (nullish coalescing, not falsy)", async () => {
  const captured = [];
  const client = capturingClient("claude-x", { message: "reacting", dealKillers: [] }, captured);
  await spawn("drive-by-installer", { mode: "comment", artifact }, { client, temperature: 0 });
  assert.equal(captured[0].temperature, 0);
});

// ── panelist#113: per-call model pass-through ───────────────────────────────

test("spawn forwards opts.model to client.complete when supplied", async () => {
  const captured = [];
  const client = capturingClient("claude-x", { message: "reacting", dealKillers: [] }, captured);
  await spawn("drive-by-installer", { mode: "comment", artifact, model: "claude-haiku-4-5" }, { client });
  assert.equal(captured.length, 1);
  assert.equal(captured[0].model, "claude-haiku-4-5");
});

test("spawn omits the model key entirely (not model: undefined) when opts.model is not given", async () => {
  const captured = [];
  const client = capturingClient("claude-x", { message: "reacting", dealKillers: [] }, captured);
  await spawn("drive-by-installer", { mode: "comment", artifact }, { client });
  assert.equal(captured.length, 1);
  assert.equal("model" in captured[0], false); // absent key, so the adapter's own default model is used
});
