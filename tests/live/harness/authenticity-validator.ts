import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { loadConfig } from '../config.js';
import { resolveScenarioAuthenticityRoute } from './authenticity-routing.js';
import type { AuthenticityRoute } from './authenticity-routing.js';
import type {
  Provider,
  ScenarioDeliveryEvidence,
  ScenarioExecutionResult,
  TemplateType,
} from './types.js';

export { resolveScenarioAuthenticityRoute } from './authenticity-routing.js';
export type { AuthenticityRoute } from './authenticity-routing.js';

export type AuthenticityStatus = 'PASS' | 'NOT_PASS';

export interface DeterministicCheckResult {
  checkId: string;
  status: AuthenticityStatus;
  rationale: string;
  evidenceRefs: string[];
}

export interface DeterministicValidatorResult {
  status: AuthenticityStatus;
  checks: DeterministicCheckResult[];
}

export interface LlmCheckResult {
  checkId: string;
  status: AuthenticityStatus;
  rationale: string;
  evidenceRefs: string[];
}

export interface LlmValidatorVerdict {
  verdict: AuthenticityStatus;
  summary: string;
  checks: LlmCheckResult[];
  missingEvidenceRefs: string[];
}

export interface LlmValidatorResult {
  status: AuthenticityStatus;
  provider: string;
  model: string;
  durationMs: number;
  input: {
    timeoutMs: number;
    apiBaseUrl: string;
    evidenceRefs: string[];
    deterministicSummary: string;
    promptVersion: string;
  };
  output?: {
    responseId?: string;
    responseModel?: string;
    rawText: string;
    verdict: LlmValidatorVerdict;
  };
  error?: string;
}

export interface AuthenticityGateResult {
  status: AuthenticityStatus;
  route: AuthenticityRoute;
  artifactPath: string;
  deterministic: DeterministicValidatorResult;
  llm?: LlmValidatorResult;
  reason?: string;
}

export interface ScenarioAuthenticityInput {
  runId: string;
  scenario: string;
  provider: Provider;
  template: TemplateType;
  result: ScenarioExecutionResult;
}

interface EvidenceItem {
  ref: string;
  location: string;
  text: string;
}

const PLACEHOLDER_PATTERNS: Array<{ id: string; regex: RegExp }> = [
  { id: 'placeholder-word', regex: /\bplaceholder\b/i },
  { id: 'template-token', regex: /\{\{[^}]+\}\}/ },
  { id: 'todo-token', regex: /\bTODO\b|\bTBD\b/i },
  { id: 'replace-me', regex: /replace\s+me|<insert[^>]*>/i },
  { id: 'dummy-output', regex: /\bdummy\b|\bmock\s+output\b|lorem ipsum/i },
];

const CODE_EVIDENCE_PATTERN =
  /(diff\s+--git|^@@|^\+\+\+\s|^---\s|\bgit\s+diff\b|\bchanged\s+files?\b|\b(file|path)\s*:\s*[^\n]+\.(ts|tsx|js|jsx|py|go|java|md))/im;

const LLM_VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'summary', 'checks', 'missingEvidenceRefs'],
  properties: {
    verdict: {
      type: 'string',
      enum: ['PASS', 'NOT_PASS'],
    },
    summary: { type: 'string', minLength: 1 },
    checks: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['checkId', 'status', 'rationale', 'evidenceRefs'],
        properties: {
          checkId: { type: 'string', minLength: 1 },
          status: { type: 'string', enum: ['PASS', 'NOT_PASS'] },
          rationale: { type: 'string', minLength: 1 },
          evidenceRefs: {
            type: 'array',
            minItems: 1,
            items: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    missingEvidenceRefs: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
    },
  },
} as const;

function sanitizeForPath(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}…`;
}

function flattenStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) flattenStrings(item, out);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      flattenStrings(item, out);
    }
  }
}

function buildEvidenceCatalog(
  evidence: ScenarioDeliveryEvidence[],
  maxChars: number,
): EvidenceItem[] {
  const catalog: EvidenceItem[] = [];

  for (const pipeline of evidence) {
    catalog.push({
      ref: `pipeline:${pipeline.pipelineId}:state`,
      location: `${pipeline.pipelineId}.state`,
      text: String(pipeline.pipelineState),
    });

    for (const criterion of pipeline.acceptanceCriteria) {
      catalog.push({
        ref: `pipeline:${pipeline.pipelineId}:criterion:${catalog.length + 1}`,
        location: `${pipeline.pipelineId}.acceptanceCriteria[]`,
        text: truncateText(criterion, maxChars),
      });
    }

    for (const task of pipeline.tasks) {
      catalog.push({
        ref: `task:${task.id}:state`,
        location: `${pipeline.pipelineId}.tasks.${task.id}.state`,
        text: String(task.state),
      });

      const strings: string[] = [];
      flattenStrings(task.output, strings);
      if (strings.length > 0) {
        catalog.push({
          ref: `task:${task.id}:output`,
          location: `${pipeline.pipelineId}.tasks.${task.id}.output`,
          text: truncateText(strings.join('\n'), maxChars),
        });
      }
    }
  }

  return catalog;
}

export function runDeterministicAuthenticityValidator(
  scenario: string,
  result: ScenarioExecutionResult,
  evidence: ScenarioDeliveryEvidence[],
): DeterministicValidatorResult {
  const checks: DeterministicCheckResult[] = [];

  const validationCount = result.validations.length;
  checks.push({
    checkId: 'acceptance-structure.validations-present',
    status: validationCount > 0 ? 'PASS' : 'NOT_PASS',
    rationale:
      validationCount > 0
        ? `Scenario produced ${validationCount} validation assertions`
        : 'Scenario produced no validation assertions',
    evidenceRefs: [`scenario:${scenario}:validations`],
  });

  for (const artifactPath of result.artifacts) {
    const exists = existsSync(artifactPath);
    const isFile = exists ? statSync(artifactPath).isFile() : false;
    const size = exists && isFile ? statSync(artifactPath).size : 0;
    checks.push({
      checkId: `artifact.exists:${artifactPath}`,
      status: exists && isFile && size > 0 ? 'PASS' : 'NOT_PASS',
      rationale:
        exists && isFile && size > 0
          ? `Artifact exists and is non-empty (${size} bytes)`
          : 'Artifact missing, not a file, or empty',
      evidenceRefs: [`artifact:${artifactPath}`],
    });
  }

  for (const pipeline of evidence) {
    checks.push({
      checkId: `acceptance-structure.pipeline:${pipeline.pipelineId}`,
      status:
        pipeline.acceptanceCriteria.length > 0 &&
        pipeline.tasks.length > 0 &&
        Boolean(pipeline.pipelineState)
          ? 'PASS'
          : 'NOT_PASS',
      rationale:
        pipeline.acceptanceCriteria.length > 0 &&
        pipeline.tasks.length > 0 &&
        Boolean(pipeline.pipelineState)
          ? 'Pipeline evidence includes acceptance criteria, task list, and terminal state snapshot'
          : 'Pipeline evidence missing acceptance criteria, tasks, or state',
      evidenceRefs: [`pipeline:${pipeline.pipelineId}:state`],
    });

    const completedTasks = pipeline.tasks.filter((task) => task.state === 'completed');
    const completedOutputsOk = completedTasks.every(
      (task) =>
        task.output && typeof task.output === 'object' && Object.keys(task.output).length > 0,
    );

    checks.push({
      checkId: `acceptance-structure.completed-task-output:${pipeline.pipelineId}`,
      status: completedOutputsOk ? 'PASS' : 'NOT_PASS',
      rationale: completedOutputsOk
        ? `All ${completedTasks.length} completed tasks include non-empty output objects`
        : 'One or more completed tasks have missing/empty output objects',
      evidenceRefs: completedTasks.map((task) => `task:${task.id}:output`),
    });

    const placeholderRefs: string[] = [];
    const fallbackStubRefs: string[] = [];

    for (const task of pipeline.tasks) {
      const strings: string[] = [];
      flattenStrings(task.output, strings);
      for (const text of strings) {
        if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.regex.test(text))) {
          placeholderRefs.push(`task:${task.id}:output`);
          break;
        }
      }

      const output = task.output;
      if (
        output &&
        typeof output === 'object' &&
        !Array.isArray(output) &&
        Object.keys(output).length === 3 &&
        Object.prototype.hasOwnProperty.call(output, 'task_id') &&
        (output as Record<string, unknown>)['handled_by'] === 'built-in-worker' &&
        (output as Record<string, unknown>)['status'] === 'completed'
      ) {
        fallbackStubRefs.push(`task:${task.id}:output`);
      }
    }

    checks.push({
      checkId: `placeholder-rejection.output-markers:${pipeline.pipelineId}`,
      status: placeholderRefs.length === 0 ? 'PASS' : 'NOT_PASS',
      rationale:
        placeholderRefs.length === 0
          ? 'No placeholder/template markers detected in delivery outputs'
          : 'Detected placeholder/template markers in task output',
      evidenceRefs:
        placeholderRefs.length > 0 ? placeholderRefs : [`pipeline:${pipeline.pipelineId}:state`],
    });

    checks.push({
      checkId: `placeholder-rejection.fallback-stub:${pipeline.pipelineId}`,
      status: fallbackStubRefs.length === 0 ? 'PASS' : 'NOT_PASS',
      rationale:
        fallbackStubRefs.length === 0
          ? 'No synthetic fallback stub output envelope detected'
          : 'Detected synthetic fallback stub output envelope (task_id + handled_by + status)',
      evidenceRefs:
        fallbackStubRefs.length > 0 ? fallbackStubRefs : [`pipeline:${pipeline.pipelineId}:state`],
    });

    if (pipeline.requiresGitDiffEvidence) {
      const outputBlob = pipeline.tasks.map((task) => JSON.stringify(task.output ?? {})).join('\n');
      const hasGitEvidence = CODE_EVIDENCE_PATTERN.test(outputBlob);
      checks.push({
        checkId: `git-diff-linkage:${pipeline.pipelineId}`,
        status: hasGitEvidence ? 'PASS' : 'NOT_PASS',
        rationale: hasGitEvidence
          ? 'Found git/diff or file-level change evidence in delivery outputs'
          : 'No git/diff or file-level change evidence found for a scenario requiring code-change linkage',
        evidenceRefs: hasGitEvidence
          ? pipeline.tasks.map((task) => `task:${task.id}:output`)
          : [`pipeline:${pipeline.pipelineId}:state`],
      });
    }

    for (const requiredArtifactPath of pipeline.requiredArtifacts ?? []) {
      const exists = existsSync(requiredArtifactPath);
      const isFile = exists ? statSync(requiredArtifactPath).isFile() : false;
      const size = exists && isFile ? statSync(requiredArtifactPath).size : 0;
      checks.push({
        checkId: `artifact.exists:${requiredArtifactPath}`,
        status: exists && isFile && size > 0 ? 'PASS' : 'NOT_PASS',
        rationale:
          exists && isFile && size > 0
            ? `Artifact exists and is non-empty (${size} bytes)`
            : 'Artifact missing, not a file, or empty',
        evidenceRefs: [`artifact:${requiredArtifactPath}`],
      });
    }
  }

  const status: AuthenticityStatus = checks.every((check) => check.status === 'PASS')
    ? 'PASS'
    : 'NOT_PASS';

  return { status, checks };
}

function isLlmVerdict(value: unknown): value is LlmValidatorVerdict {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.verdict !== 'PASS' && record.verdict !== 'NOT_PASS') return false;
  if (typeof record.summary !== 'string' || record.summary.length === 0) return false;
  if (!Array.isArray(record.checks) || record.checks.length === 0) return false;
  if (!Array.isArray(record.missingEvidenceRefs)) return false;

  return record.checks.every((check) => {
    if (!check || typeof check !== 'object') return false;
    const c = check as Record<string, unknown>;
    return (
      typeof c.checkId === 'string' &&
      (c.status === 'PASS' || c.status === 'NOT_PASS') &&
      typeof c.rationale === 'string' &&
      Array.isArray(c.evidenceRefs) &&
      c.evidenceRefs.length > 0 &&
      c.evidenceRefs.every((ref) => typeof ref === 'string' && ref.length > 0)
    );
  });
}

async function callOpenAiStrictJson(
  apiBaseUrl: string,
  apiKey: string,
  model: string,
  timeoutMs: number,
  prompt: string,
): Promise<{ responseId?: string; responseModel?: string; rawText: string; parsed: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content:
              'You are an output-authenticity auditor. Evaluate only evidence provided. Never infer missing evidence. Return strict JSON only.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'delivery_authenticity_verdict',
            strict: true,
            schema: LLM_VERDICT_SCHEMA,
          },
        },
      }),
    });

    const payload = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      throw new Error(`OpenAI API ${response.status}: ${JSON.stringify(payload)}`);
    }

    const choice = Array.isArray(payload.choices)
      ? (payload.choices[0] as Record<string, unknown> | undefined)
      : undefined;
    const message =
      choice && typeof choice === 'object'
        ? (choice.message as Record<string, unknown> | undefined)
        : undefined;
    const rawText = message && typeof message.content === 'string' ? message.content : '';

    if (!rawText.trim()) {
      throw new Error('OpenAI response did not include message.content JSON payload');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch (error) {
      throw new Error(`OpenAI response contained invalid JSON: ${String(error)}`);
    }

    return {
      responseId: typeof payload.id === 'string' ? payload.id : undefined,
      responseModel: typeof payload.model === 'string' ? payload.model : undefined,
      rawText,
      parsed,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runLlmAuthenticityValidator(
  scenario: string,
  deterministic: DeterministicValidatorResult,
  evidenceCatalog: EvidenceItem[],
): Promise<LlmValidatorResult> {
  const startedAt = Date.now();
  const config = loadConfig();
  const provider = config.authenticityLlmProvider;
  const model = config.authenticityLlmModel;
  const timeoutMs = config.authenticityLlmTimeoutMs;
  const deterministicSummary = deterministic.checks
    .map((check) => `${check.checkId}=${check.status}`)
    .join('; ');

  const baseResult: Omit<LlmValidatorResult, 'status'> = {
    provider,
    model,
    durationMs: 0,
    input: {
      timeoutMs,
      apiBaseUrl: config.authenticityLlmApiBaseUrl,
      evidenceRefs: evidenceCatalog.map((entry) => entry.ref),
      deterministicSummary,
      promptVersion: 'v1',
    },
  };

  if (provider !== 'openai') {
    return {
      ...baseResult,
      durationMs: Date.now() - startedAt,
      status: 'NOT_PASS',
      error: `Unsupported authenticity LLM provider: ${provider}. Only openai is supported in phase 1.`,
    };
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return {
      ...baseResult,
      durationMs: Date.now() - startedAt,
      status: 'NOT_PASS',
      error: 'Missing OPENAI_API_KEY for authenticity LLM validator',
    };
  }

  const prompt = [
    `Scenario: ${scenario}`,
    'Audit objective: verify whether delivery output appears authentic (grounded, specific, evidenced) or synthetic/template output.',
    'Return PASS only when evidence concretely supports authenticity. If evidence is weak, missing, generic, or contradictory, return NOT_PASS.',
    'Every check must include one or more evidenceRefs from the supplied catalog.',
    '',
    'Deterministic validator summary:',
    deterministicSummary,
    '',
    'Evidence catalog (ref => excerpt):',
    ...evidenceCatalog.map((entry) => `- ${entry.ref} => ${entry.text}`),
  ].join('\n');

  try {
    const response = await callOpenAiStrictJson(
      config.authenticityLlmApiBaseUrl,
      apiKey,
      model,
      timeoutMs,
      prompt,
    );

    if (!isLlmVerdict(response.parsed)) {
      return {
        ...baseResult,
        durationMs: Date.now() - startedAt,
        status: 'NOT_PASS',
        output: {
          responseId: response.responseId,
          responseModel: response.responseModel,
          rawText: response.rawText,
          verdict: {
            verdict: 'NOT_PASS',
            summary: 'Invalid verdict schema from LLM',
            checks: [],
            missingEvidenceRefs: [],
          },
        },
        error: 'LLM output did not match strict verdict schema',
      };
    }

    const verdict = response.parsed;
    const allEvidenceRefs = verdict.checks.flatMap((check) => check.evidenceRefs);
    const validRefs = new Set(evidenceCatalog.map((entry) => entry.ref));

    const hasUnknownRefs = allEvidenceRefs.some((ref) => !validRefs.has(ref));
    if (allEvidenceRefs.length === 0 || hasUnknownRefs) {
      return {
        ...baseResult,
        durationMs: Date.now() - startedAt,
        status: 'NOT_PASS',
        output: {
          responseId: response.responseId,
          responseModel: response.responseModel,
          rawText: response.rawText,
          verdict,
        },
        error:
          allEvidenceRefs.length === 0
            ? 'LLM verdict contained no evidence refs (fail-closed)'
            : 'LLM verdict referenced unknown evidence refs (fail-closed)',
      };
    }

    const llmStatus: AuthenticityStatus =
      verdict.verdict === 'PASS' &&
      verdict.missingEvidenceRefs.length === 0 &&
      verdict.checks.every((check) => check.status === 'PASS')
        ? 'PASS'
        : 'NOT_PASS';

    return {
      ...baseResult,
      durationMs: Date.now() - startedAt,
      status: llmStatus,
      output: {
        responseId: response.responseId,
        responseModel: response.responseModel,
        rawText: response.rawText,
        verdict,
      },
      error: llmStatus === 'PASS' ? undefined : verdict.summary,
    };
  } catch (error) {
    return {
      ...baseResult,
      durationMs: Date.now() - startedAt,
      status: 'NOT_PASS',
      error: `LLM validator failure (fail-closed): ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function writeAuthenticityArtifact(
  input: ScenarioAuthenticityInput,
  route: AuthenticityRoute,
  deterministic: DeterministicValidatorResult,
  llm: LlmValidatorResult | undefined,
  finalStatus: AuthenticityStatus,
): string {
  const artifactDir = path.join(
    process.cwd(),
    'tests',
    'artifacts',
    'live',
    'validators',
    sanitizeForPath(input.runId),
  );
  mkdirSync(artifactDir, { recursive: true });

  const artifactPath = path.join(
    artifactDir,
    `${sanitizeForPath(input.scenario)}-authenticity.json`,
  );

  const payload = {
    version: '1.0',
    runId: input.runId,
    scenario: input.scenario,
    providerUnderTest: input.provider,
    template: input.template,
    route,
    generatedAt: new Date().toISOString(),
    result: {
      status: finalStatus,
    },
    validatorInput: {
      validations: input.result.validations,
      artifacts: input.result.artifacts,
      authenticityEvidence: input.result.authenticityEvidence ?? [],
    },
    deterministicValidator: deterministic,
    llmValidator: llm,
  };

  writeFileSync(artifactPath, JSON.stringify(payload, null, 2) + '\n');
  return path.relative(process.cwd(), artifactPath).replaceAll('\\', '/');
}

export async function enforceScenarioAuthenticityGate(
  input: ScenarioAuthenticityInput,
): Promise<AuthenticityGateResult> {
  const route = resolveScenarioAuthenticityRoute(input.scenario);
  const evidence = input.result.authenticityEvidence ?? [];
  const deterministic = runDeterministicAuthenticityValidator(
    input.scenario,
    input.result,
    evidence,
  );

  let llm: LlmValidatorResult | undefined;
  let finalStatus: AuthenticityStatus = deterministic.status;
  let reason: string | undefined;

  if (deterministic.status !== 'PASS') {
    reason = 'Deterministic authenticity validator returned NOT_PASS';
  } else if (route === 'hybrid-llm') {
    const config = loadConfig();
    const evidenceCatalog = buildEvidenceCatalog(evidence, config.authenticityLlmMaxEvidenceChars);

    if (evidenceCatalog.length === 0) {
      llm = {
        status: 'NOT_PASS',
        provider: config.authenticityLlmProvider,
        model: config.authenticityLlmModel,
        durationMs: 0,
        input: {
          timeoutMs: config.authenticityLlmTimeoutMs,
          apiBaseUrl: config.authenticityLlmApiBaseUrl,
          evidenceRefs: [],
          deterministicSummary: 'no-evidence-catalog',
          promptVersion: 'v1',
        },
        error: 'No evidence catalog available for LLM validator (fail-closed)',
      };
      finalStatus = 'NOT_PASS';
      reason = llm.error;
    } else {
      llm = await runLlmAuthenticityValidator(input.scenario, deterministic, evidenceCatalog);
      if (llm.status !== 'PASS') {
        finalStatus = 'NOT_PASS';
        reason = llm.error ?? 'LLM authenticity validator returned NOT_PASS';
      }
    }
  }

  const artifactPath = writeAuthenticityArtifact(input, route, deterministic, llm, finalStatus);

  return {
    status: finalStatus,
    route,
    artifactPath,
    deterministic,
    llm,
    reason,
  };
}
