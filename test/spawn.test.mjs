import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "../src/lib/spawn.mjs";
import { registerPersonas, clearRegistry } from "../src/lib/register.mjs";
import { fixedSpawn, mockClient } from "./_helpers.mjs";
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
  assert.deepEqual(Object.keys(out).sort(), ["dealKillers", "message", "mode", "personaId", "verdict"]);
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
