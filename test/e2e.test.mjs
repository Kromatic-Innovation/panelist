// End-to-end: the shipped review pack + the runtime loader + spawn compose into
// a well-formed wrapper, entirely offline (mock client).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registerPersonas, spawn, clearRegistry } from "../src/index.mjs";
import { fixedSpawn } from "./_helpers.mjs";
import reviewPack from "../packs/review/index.mjs";

beforeEach(() => clearRegistry());

test("registerPersonas(reviewPack) then spawn(vote) returns a well-formed wrapper", async () => {
  const roster = registerPersonas(reviewPack);
  assert.equal(roster.length, 4);

  const client = fixedSpawn("claude-3-5-sonnet", {
    verdict: { decision: "reject" },
    message: "The README opens with philosophy; I never found the install line, so I bounced.",
    dealKillers: ["prose before the install command"],
  });

  const out = await spawn(
    "drive-by-installer",
    {
      mode: "vote",
      artifact: "# plenum\nA synthetic persona panel.\n\n## Philosophy\n...long prose...",
      instruction: "Would you get this installed in two minutes?",
      responseSchema: { type: "object", properties: { decision: { enum: ["approve", "reject"] } } },
    },
    { client },
  );

  assert.equal(out.personaId, "drive-by-installer");
  assert.equal(out.mode, "vote");
  assert.deepEqual(out.verdict, { decision: "reject" });
  assert.ok(out.message.includes("install"));
  assert.deepEqual(out.dealKillers, ["prose before the install command"]);
});
