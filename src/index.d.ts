// Hand-written type declarations for panelist's public entry (src/index.mjs).
// Where a shape is large or open-ended, `unknown` / loose records are used on purpose:
// accuracy over detail. The subpath packs (panelist/packs/*) are not typed.
// A drift test (test/types.test.mjs) keeps this file's export names in lockstep
// with src/index.mjs.

export const PANELIST_VERSION: string;

// ── Shared shapes ───────────────────────────────────────────────────────────

/** A persona record (see PERSONA_SCHEMA). Unknown extra keys are tolerated at runtime. */
export interface Persona {
  id: string;
  name: string;
  role: string;
  caresAbout: string[];
  rewards: string[];
  punishes: string[];
  quitsWhen: string[];
  lens?: string;
  modelTier?: string;
  [key: string]: unknown;
}

/** A rubric: axes (array or { axis: description }), kill axes, thresholds. */
export interface Rubric {
  axes?: string[] | Record<string, string>;
  killAxes?: string[];
  killFloor?: number;
  cut_threshold?: number;
  quorum?: number;
  [key: string]: unknown;
}

/** An injected model client. `complete` returns the model's text reply. */
export interface ModelClient {
  model?: string;
  complete: (...args: any[]) => Promise<any> | any;
  temperature?: number;
  [key: string]: unknown;
}

export interface PersonaSource {
  personas?: Persona[];
  rubrics?: Record<string, Rubric>;
  usage?: string;
  modelTier?: string;
  [key: string]: unknown;
}

export type RegisterSource = Persona[] | Persona | PersonaSource;

export interface IsolationEnvelope {
  tools: string[];
  denied: ToolDenial[];
}

export interface ToolDenial {
  tool: string;
  reviewer: string | null;
  at: string;
}

export interface ToolGate {
  tools: string[];
  check: (toolId: string) => boolean;
  denied: ToolDenial[];
}

// ── Registry ────────────────────────────────────────────────────────────────

export function registerPersonas(...sources: RegisterSource[]): Persona[];
export function registerRubric<T = Rubric>(key: string, rubric: T): T;
export function getPersona(id: string): Persona | null;
export function getPersonas(
  filter?: ((persona: Persona) => boolean) | Record<string, unknown>,
): Persona[];
export function getRubric(key: string): Rubric | null;
export function getUsage(): string;
export function clearRegistry(): void;

// ── Cross-model scoring ─────────────────────────────────────────────────────

export interface ScoreDeps {
  panel?: ModelClient[];
  buildPrompt?: (args: {
    persona: Persona;
    candidate: unknown;
    rubric: unknown;
    intro?: string;
  }) => string;
  intro?: string;
  fallback?: (...args: any[]) => Record<string, unknown>;
  concurrency?: number;
  limiter?: <T>(fn: () => Promise<T>) => Promise<T>;
  maxTokens?: number;
  temperature?: number;
  [key: string]: unknown;
}

export interface Candidate {
  text?: string;
  [key: string]: unknown;
}

/** The evaluation envelope; large and open-ended, so loosely typed. */
export interface Evaluation {
  verdict: string;
  aggregate?: Record<string, number>;
  honesty: string;
  isolation: IsolationEnvelope;
  [key: string]: unknown;
}

export function score(
  candidate: Candidate | null | undefined,
  personas: Persona[],
  rubric?: Rubric,
  deps?: ScoreDeps,
): Promise<Evaluation>;
export function scoreCandidate(
  candidate: Candidate | null | undefined,
  personas: Persona[],
  rubric?: Rubric,
  deps?: ScoreDeps,
): Promise<Evaluation>;
export function rankCandidatesWith(
  candidates: Candidate[],
  personas: Persona[],
  rubric?: Rubric,
  deps?: ScoreDeps,
): Promise<Record<string, unknown>>;
export function createLimiter(max: number): <T>(fn: () => Promise<T>) => Promise<T>;
export function normalizeRubric(rubric?: Rubric): Record<string, unknown>;
export function decideVerdict(aggregate: Record<string, number>, rubric?: Rubric): "keep" | "cut";
export function extractScore(text: unknown, axes?: string[]): Record<string, unknown> | null;
export function extractJsonObject(text: unknown): Record<string, unknown> | null;
export function buildEvalPrompt(args: {
  persona: Persona;
  candidate?: Candidate;
  rubric?: Rubric;
  intro?: string;
}): string;
export function renderPersona(persona: Persona): string;
export function providerOf(modelId: unknown): string;
/** Wrap untrusted text in triple-quote fences, neutralizing embedded fence runs. */
export function fenceArtifact(text: unknown): string;
/** Number of panelists that must report for quorum (strictly more than `quorum`, clamped). */
export function quorumRequired(panelSize: number, quorum?: number): number;

// ── Single-turn invocation ──────────────────────────────────────────────────

export type SpawnMode = "vote" | "comment" | "converse" | (string & {});

export interface SpawnOptions {
  mode: SpawnMode;
  artifact?: unknown;
  instruction?: string;
  responseSchema?: unknown;
  horizon?: unknown;
  tools?: string[] | null;
  model?: string;
  [key: string]: unknown;
}

export interface SpawnDeps {
  client?: ModelClient;
  buildPrompt?: (args: Record<string, unknown>) => string;
  toolGate?: ToolGate;
  maxTokens?: number;
  temperature?: number;
  [key: string]: unknown;
}

export interface SpawnResult {
  personaId: string;
  mode: string;
  verdict: Record<string, unknown> | null;
  message: string;
  dealKillers: string[];
  isolation: IsolationEnvelope;
  honesty?: string;
  [key: string]: unknown;
}

export function spawn(personaId: string, opts?: SpawnOptions, deps?: SpawnDeps): Promise<SpawnResult>;
export function buildSpawnPrompt(args: {
  persona: Persona;
  mode: SpawnMode;
  artifact?: unknown;
  instruction?: string;
  responseSchema?: unknown;
  horizon?: unknown;
}): string;

export function renderRunnerPrompt(personaId: string, task?: Partial<SpawnOptions>, deps?: SpawnDeps): string;
export function runPersona(personaId: string, task?: Partial<SpawnOptions>, deps?: SpawnDeps): Promise<SpawnResult>;

// ── Junction contract ───────────────────────────────────────────────────────

export const BAIL: "bail";

export interface JunctionDecision {
  id: string;
  label?: string;
}

export interface Junction {
  content: string | ((state: unknown) => string);
  decisions?: (state: unknown) => JunctionDecision[];
  cost?: number;
  [key: string]: unknown;
}

export interface JunctionGraph {
  entry: string;
  junctions: Record<string, Junction>;
  patience?: (horizon: unknown) => number;
  [key: string]: unknown;
}

export interface JunctionLoopOptions {
  horizon?: unknown;
  spawnStrategy?: string;
  client?: ModelClient;
  patienceBudget?: number | ((args: { horizon: unknown }) => number);
  tools?: string[] | null;
  toolGate?: ToolGate;
  maxTokens?: number;
  temperature?: number;
  maxTurns?: number;
  [key: string]: unknown;
}

export interface JunctionLoopResult {
  entry: string;
  path: unknown[];
  stopReason: "bail" | "budget-exhausted" | "terminal" | "invalid-decision" | "max-turns";
  turns: number;
  budgetRemaining: number;
  transcript: unknown[];
  trace: JunctionTrace;
  verdict: unknown;
  isolation: IsolationEnvelope;
  [key: string]: unknown;
}

export interface JunctionReaction {
  junction: string;
  engagement: Engagement;
  decision: string | null;
  reactionText: string;
}

export interface JunctionTrace {
  entryJunction: string;
  junctionTrace: JunctionReaction[];
  dropOff: { stoppedAt: string; reason: string };
}

export function runJunctionLoop(
  graph: JunctionGraph,
  persona: Persona,
  opts?: JunctionLoopOptions,
  hooks?: Record<string, unknown>,
): Promise<JunctionLoopResult>;

export type Engagement = "kept" | "skimmed" | "bailed";
export const ENGAGEMENT: Readonly<{ KEPT: "kept"; SKIMMED: "skimmed"; BAILED: "bailed" }>;
export const REACTION_KEYS: readonly string[];
export const TRACE_KEYS: readonly string[];
export function deriveEngagement(decision: string | null | undefined): "kept" | "bailed";
export function normalizeEngagement(engagement: unknown, decision: string | null | undefined): Engagement;
export function reactionFrom(turn: {
  junctionId: string;
  engagement?: string;
  decision: string | null;
  reaction?: string;
}): JunctionReaction;
export function buildTrace(loopResult: {
  entry: string;
  path?: unknown[];
  stopReason?: string;
}): JunctionTrace;
export function aggregateJunctionTraces(traces?: Array<JunctionTrace | null | undefined>): {
  runs: number;
  dropOff: Record<string, number>;
  perJunction: Record<string, { visits: number; kept: number; skimmed: number; bailed: number }>;
};

// ── Calibration ─────────────────────────────────────────────────────────────

export function calibratePersonas(args?: {
  items?: unknown[];
  syntheticByPersona?: Record<string, unknown>;
  realSignal?: unknown;
  keepThreshold?: number;
  goodThreshold?: number;
}): { leaderboard: Array<Record<string, unknown>>; n: number; note: string; [key: string]: unknown };
export function spearmanRankCorrelation(a: unknown[], b: unknown[]): number | null;
export function keptSetHitRate(keptFlags: unknown[], realGoodFlags: unknown[]): number | null;

// ── Schema ──────────────────────────────────────────────────────────────────

export const SCHEMA_VERSION: number;
export const USAGE_HEADER: string;
export const PERSONA_SCHEMA: Record<string, unknown>;
export const PERSONA_FIELDS: string[];
export const REQUIRED_FIELDS: string[];
export const FORBIDDEN_FIELDS: string[];
export function validatePersona(record: unknown): { ok: boolean; errors: string[] };
export function isPersonaShaped(o: unknown): boolean;

// ── Drift-check ─────────────────────────────────────────────────────────────

export interface DriftReport {
  ok: boolean;
  checked: number;
  valid: string[];
  invalid: Array<{ id: string; errors: string[] }>;
  duplicateIds: string[];
}

export function checkRecords(records: unknown[]): DriftReport;
export function driftScanRepo(packs?: unknown[][]): Promise<DriftReport>;
export function formatDriftReport(report: DriftReport): string;
export function checkHonesty(summaries: Array<string | object>): { ok: boolean; offenders: number[] };

// ── Honesty ─────────────────────────────────────────────────────────────────

export const HONESTY_MARKER: string;
export function stampHonesty<T extends object>(envelope: T, usage?: string): T & { honesty: string };
export function formatPanelSummary(evaluation: Record<string, unknown>, opts?: { label?: string }): string;
export function assertHonestyStamped(x: string | object): { ok: boolean; reason?: string };

// ── Tool isolation ──────────────────────────────────────────────────────────

export const DISCOVERY_TOOLS: readonly string[];
export function resolveEffectiveTools(requested?: string[] | null): string[];
export function isToolGranted(toolId: unknown, effectiveTools: string[]): boolean;
export function recordDenial(toolId: string, reviewer?: string | null, at?: string): ToolDenial;
export function createToolGate(opts?: { tools?: string[] | null; reviewer?: string }): ToolGate;
export function buildIsolationEnvelope(effectiveTools?: string[], denied?: ToolDenial[]): IsolationEnvelope;
export function unionTools(records?: Array<{ isolation?: { tools?: string[] } }>): string[];
