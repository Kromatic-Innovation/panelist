#!/usr/bin/env node
// eval/contract-conformance.mjs — MANUAL eval: default-prompt CONTRACT
// conformance across every model panelist claims to support (panelist#95).
//
// WHAT THIS CHECKS (and does NOT check):
//   Does panelist's DEFAULT prompt (buildEvalPrompt / buildSpawnPrompt / the
//   junction CONTRACT prompt) reliably produce output that panelist's OWN
//   parser (extractScore / extractJsonObject) can consume, on every model we
//   claim to support? That is it. This is a PARSEABILITY check, not a verdict
//   quality check — it does not ask "is the persona's judgement good," only
//   "did the model return something panelist's own code can parse."
//
// This is a MANUALLY-TRIGGERED eval, not a test:
//   - It is NOT under test/ (so `npm test` / `node --test test/*.test.mjs`
//     never picks it up).
//   - `eval/` is NOT listed in package.json's `files`, so it is never
//     published to npm.
//   - It spends REAL tokens against REAL provider APIs. It must never run on
//     push or on a pull_request, and it must never be a required check — see
//     .github/workflows/eval-contract-conformance.yml (workflow_dispatch only).
//
// ZERO added dependency (SECURITY.md: zero runtime deps is load-bearing).
// This file is a CONSUMER of panelist through the existing injected-client
// contract `{ model, complete: async ({ prompt, maxTokens, temperature,
// tools }) => ({ ok, text, model }) }` — exactly like a real caller would
// wire up PromptFoo/LiteLLM/etc. Provider calls below use Node 20's built-in
// global `fetch` directly against the Anthropic Messages API and the OpenAI
// Chat Completions API. No SDK. Nothing is added to `dependencies` or
// `devDependencies`.
//
// Run locally:
//   ANTHROPIC_API_KEY=... OPENAI_API_KEY=... node eval/contract-conformance.mjs
//
// Run without credentials (safe, always works — see README note):
//   node eval/contract-conformance.mjs
// This still runs the (free, no-API-call) providerOf() bucketing assertions,
// and prints a clear "skipped: no <PROVIDER>_API_KEY" row for every
// credentialed plane it can't attempt. Exit code is 0 as long as nothing it
// actually attempted failed.

import { score, providerOf } from "../src/lib/score.mjs";
import { spawn, buildSpawnPrompt } from "../src/lib/spawn.mjs";
import { runJunctionLoop } from "../src/lib/junction.mjs";
import { registerPersonas, getPersona, clearRegistry } from "../src/lib/register.mjs";
import reviewPack from "../packs/review/index.mjs";

// ─────────────────────────────────────────────────────────────────────────
// MODELS IN SCOPE
//
// RE-VERIFY these IDs against the live provider catalogs before running —
// model lineups move faster than issues; correct as of 2026-07-30. Do NOT
// substitute IDs from training knowledge, which is stale by the time this
// runs. Edit this table in place when the supported lineup changes.
// ─────────────────────────────────────────────────────────────────────────
const MODELS = [
  { provider: "anthropic", id: "claude-opus-5", tier: "Opus (flagship)" },
  { provider: "anthropic", id: "claude-sonnet-5", tier: "Sonnet (mid)" },
  { provider: "anthropic", id: "claude-haiku-4-5", tier: "Haiku (cost)" },
  { provider: "openai", id: "gpt-5.6-sol", tier: "Flagship (alias gpt-5.6)" },
  { provider: "openai", id: "gpt-5.6-terra", tier: "Mid" },
  { provider: "openai", id: "gpt-5.6-luna", tier: "Cost" },
];

const PLANES = ["scoring", "singleTurn", "singleTurnSchema", "multiTurn"];

const VOTE_SCHEMA = { type: "object", properties: { verdict: { enum: ["approve", "reject"] } } };

// ─────────────────────────────────────────────────────────────────────────
// Minimal provider adapters — raw fetch, no SDK.
//
// Each returns the injected-client shape score.mjs/spawn.mjs/junction.mjs
// expect: { model, complete: async ({ prompt, maxTokens, temperature }) =>
// { ok, text, model } }. A transport/HTTP failure resolves `{ ok: false,
// reason }` rather than throwing, so one bad call doesn't crash the matrix
// (score.mjs already treats a thrown complete() as "failed"; spawn/junction
// require ok:true or they throw — the harness catches that per-cell, see
// runCell below).
// ─────────────────────────────────────────────────────────────────────────

function anthropicClient(modelId, apiKey) {
  return {
    model: modelId,
    async complete({ prompt, maxTokens, temperature }) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: modelId,
          max_tokens: maxTokens ?? 512,
          temperature: temperature ?? 0,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { ok: false, reason: `anthropic HTTP ${res.status}: ${body.slice(0, 300)}` };
      }
      const json = await res.json();
      const text = Array.isArray(json.content)
        ? json.content.filter((b) => b.type === "text").map((b) => b.text).join("")
        : "";
      return { ok: true, text, model: modelId };
    },
  };
}

function openaiClient(modelId, apiKey) {
  return {
    model: modelId,
    async complete({ prompt, maxTokens, temperature }) {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelId,
          max_tokens: maxTokens ?? 512,
          temperature: temperature ?? 0,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { ok: false, reason: `openai HTTP ${res.status}: ${body.slice(0, 300)}` };
      }
      const json = await res.json();
      const text = json.choices?.[0]?.message?.content ?? "";
      return { ok: true, text, model: modelId };
    },
  };
}

function clientFor(modelEntry, env) {
  if (modelEntry.provider === "anthropic") {
    if (!env.ANTHROPIC_API_KEY) return null;
    return anthropicClient(modelEntry.id, env.ANTHROPIC_API_KEY);
  }
  if (modelEntry.provider === "openai") {
    if (!env.OPENAI_API_KEY) return null;
    return openaiClient(modelEntry.id, env.OPENAI_API_KEY);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Real fixtures: the shipped review pack + a minimal real junction graph, so
// the DEFAULT prompt builders (buildEvalPrompt / buildSpawnPrompt / the
// junction CONTRACT) are the ones actually exercised — no custom
// deps.buildPrompt override anywhere in this file.
// ─────────────────────────────────────────────────────────────────────────

registerPersonas(reviewPack);
const PERSONA_ID = "drive-by-installer";
const PERSONA = getPersona(PERSONA_ID);

const CANDIDATE = {
  text: "# my-project\n\nInstall: `npm i my-project`\n\nA small CLI that does one thing well.",
};

const RUBRIC = { axes: ["resonance", "clarity", "credibility", "scrollStop"], killAxes: ["clarity"] };

function miniJunctionGraph() {
  return {
    entry: "readme_top",
    junctions: {
      readme_top: {
        content: "# my-project\n\nInstall: `npm i my-project`",
        decisions: () => [{ id: "readme_usage", label: "Keep reading — usage section" }],
      },
      readme_usage: {
        content: "## Usage\n\nimport { thing } from 'my-project';\nthing();",
        decisions: () => [], // terminal
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Per-plane cell runners. Each returns { pass: boolean, reason?: string }.
// A cell that THROWS (spawn/runJunctionLoop throw on a non-ok client reply)
// is caught here and reported as a fail with the thrown message, rather than
// crashing the whole matrix run.
// ─────────────────────────────────────────────────────────────────────────

async function runScoringCell(client) {
  const result = await score(CANDIDATE, [PERSONA], RUBRIC, { panel: [client], concurrency: 1 });
  if (result.panelistsFailed > 0 || result.panelistsReported === 0) {
    return { pass: false, reason: `panelistsFailed=${result.panelistsFailed}, panelistsReported=${result.panelistsReported}` };
  }
  const row = result.scores.byPersona[0];
  if (!row) return { pass: false, reason: "no per-persona row returned" };
  for (const axis of RUBRIC.axes) {
    const v = row[axis];
    if (typeof v !== "number" || !(v >= 0 && v <= 10)) {
      return { pass: false, reason: `axis "${axis}" not a number in [0,10] (got ${JSON.stringify(v)})` };
    }
  }
  return { pass: true };
}

async function runSingleTurnCell(client) {
  const out = await spawn(PERSONA_ID, { mode: "comment", artifact: CANDIDATE.text }, { client });
  if (typeof out.message !== "string" || !out.message.trim()) {
    return { pass: false, reason: "message is empty/non-string" };
  }
  if (!Array.isArray(out.dealKillers)) {
    return { pass: false, reason: "dealKillers is not an array" };
  }
  return { pass: true };
}

async function runSingleTurnSchemaCell(client) {
  const out = await spawn(
    PERSONA_ID,
    { mode: "vote", artifact: CANDIDATE.text, instruction: "Would you try it?", responseSchema: VOTE_SCHEMA },
    { client },
  );
  if (out.verdict === null || out.verdict === undefined) {
    return { pass: false, reason: "verdict is null despite a responseSchema" };
  }
  return { pass: true };
}

async function runMultiTurnCell(client) {
  const out = await runJunctionLoop(miniJunctionGraph(), PERSONA, {
    spawnStrategy: "respawn",
    client,
    horizon: "web",
  });
  if (!Array.isArray(out.path) || out.path.length === 0) {
    return { pass: false, reason: "no turns recorded" };
  }
  for (const turn of out.path) {
    if (turn.decision === null || turn.decision === undefined) {
      return { pass: false, reason: `turn ${turn.turn} at "${turn.junctionId}" produced no decision` };
    }
  }
  if (out.stopReason === "invalid-decision" && out.turns <= 1) {
    return { pass: false, reason: "run ended invalid-decision on turn 1" };
  }
  return { pass: true };
}

const CELL_RUNNERS = {
  scoring: runScoringCell,
  singleTurn: runSingleTurnCell,
  singleTurnSchema: runSingleTurnSchemaCell,
  multiTurn: runMultiTurnCell,
};

async function runCell(planeKey, client) {
  try {
    return await CELL_RUNNERS[planeKey](client);
  } catch (err) {
    return { pass: false, reason: `threw: ${err && err.message ? err.message : String(err)}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// providerOf() bucketing assertions — NO API call, always runs, even
// without any credentials. This is the only place that would catch a new
// model-naming scheme silently breaking the crossModel guarantee.
// ─────────────────────────────────────────────────────────────────────────

function checkProviderBucketing() {
  const rows = [];
  let ok = true;
  for (const m of MODELS) {
    const bucketed = providerOf(m.id);
    const pass = bucketed === m.provider;
    if (!pass) ok = false;
    rows.push({ id: m.id, expected: m.provider, got: bucketed, pass });
  }
  return { ok, rows };
}

// ─────────────────────────────────────────────────────────────────────────
// Matrix rendering.
// ─────────────────────────────────────────────────────────────────────────

function pad(s, width) {
  s = String(s);
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

function printMatrix(matrix) {
  const modelColWidth = Math.max(28, ...matrix.map((r) => r.label.length + 1));
  const MAX_REASON = 40;
  const truncate = (s) => (s.length > MAX_REASON ? `${s.slice(0, MAX_REASON - 1)}…` : s);
  const cellText = (cell) => {
    if (!cell) return "?";
    if (cell.skipped) return `SKIP (${truncate(cell.reason)})`;
    if (cell.pass) return "PASS";
    return `FAIL (${truncate(cell.reason)})`;
  };
  const planeColWidth =
    Math.max(10, ...matrix.flatMap((r) => PLANES.map((p) => cellText(r.cells[p]).length))) + 2;
  console.log("");
  console.log("Contract-conformance matrix (parseability only — NOT verdict quality)");
  console.log("=".repeat(modelColWidth + planeColWidth * PLANES.length));
  const header = pad("model", modelColWidth) + PLANES.map((p) => pad(p, planeColWidth)).join("");
  console.log(header);
  console.log("-".repeat(modelColWidth + planeColWidth * PLANES.length));
  for (const row of matrix) {
    let line = pad(row.label, modelColWidth);
    for (const plane of PLANES) {
      line += pad(cellText(row.cells[plane]), planeColWidth);
    }
    console.log(line);
  }
  console.log("=".repeat(modelColWidth + planeColWidth * PLANES.length));
}

// ─────────────────────────────────────────────────────────────────────────
// Main.
// ─────────────────────────────────────────────────────────────────────────

async function main(env = process.env) {
  console.log("panelist eval: contract-conformance (#95)");
  console.log("Checks default-prompt PARSEABILITY only, not verdict quality. Spends real tokens when credentials are present.");
  console.log("");

  // 1. providerOf() bucketing — always runs, no API call, no credentials needed.
  const bucketing = checkProviderBucketing();
  console.log("providerOf() bucketing (no API call):");
  for (const row of bucketing.rows) {
    console.log(`  ${row.pass ? "PASS" : "FAIL"}  ${row.id} -> expected "${row.expected}", got "${row.got}"`);
  }
  console.log("");

  let anyHardFailure = !bucketing.ok;

  // 2. Per (model x plane) matrix.
  const matrix = [];
  for (const modelEntry of MODELS) {
    const client = clientFor(modelEntry, env);
    const row = { label: `${modelEntry.id} (${modelEntry.tier})`, cells: {} };
    for (const plane of PLANES) {
      if (!client) {
        const keyName = modelEntry.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
        row.cells[plane] = { skipped: true, reason: `no ${keyName}` };
        console.log(`skipped: no ${keyName} — ${modelEntry.id} / ${plane}`);
        continue;
      }
      const result = await runCell(plane, client);
      row.cells[plane] = result;
      if (!result.pass) anyHardFailure = true;
    }
    matrix.push(row);
  }

  printMatrix(matrix);

  console.log("");
  if (anyHardFailure) {
    console.log("RESULT: at least one attempted cell FAILED (credential-skips do not count as failures). See matrix above.");
  } else {
    console.log("RESULT: OK — no attempted cell failed (any remaining cells were credential-skips).");
  }

  return anyHardFailure ? 1 : 0;
}

// Run as a script: `node eval/contract-conformance.mjs`
if (process.argv[1]) {
  const invoked = process.argv[1].replace(/\\/g, "/");
  if (invoked.endsWith("contract-conformance.mjs")) {
    main().then((code) => {
      clearRegistry();
      process.exit(code);
    });
  }
}

export { MODELS, PLANES, checkProviderBucketing, runCell, clientFor, main };
