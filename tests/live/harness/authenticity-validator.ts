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
  resilience?: DeterministicValidatorResult;
  deliveryQualityStatus: AuthenticityStatus;
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

const RESILIENCE_ONLY_SCENARIOS = new Set(['ap7-failure-recovery', 'sdlc-sad']);
const FORBIDDEN_PASS_VALIDATIONS = new Set(['no_failure_within_timeout']);

const SYNTHETIC_SIGNATURE_SCENARIOS = new Set([
  'ap2-external-runtime',
  'ap3-standalone-worker',
  'ap4-mixed-workers',
]);

const ALLOWED_SYNTHETIC_HANDLERS: Record<string, ReadonlySet<string>> = {
  'ap2-external-runtime': new Set(['ap2-external-worker']),
  'ap3-standalone-worker': new Set(['ap3-standalone-worker']),
  'ap4-mixed-workers': new Set(['ap4-built-in-worker', 'ap4-external-worker']),
};

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

  for (const workflow of evidence) {
    catalog.push({
      ref: `workflow:${workflow.workflowId}:state`,
      location: `${workflow.workflowId}.state`,
      text: String(workflow.workflowState),
    });

    for (const criterion of workflow.acceptanceCriteria) {
      catalog.push({
        ref: `workflow:${workflow.workflowId}:criterion:${catalog.length + 1}`,
        location: `${workflow.workflowId}.acceptanceCriteria[]`,
        text: truncateText(criterion, maxChars),
      });
    }

    for (const task of workflow.tasks) {
      catalog.push({
        ref: `task:${task.id}:state`,
        location: `${workflow.workflowId}.tasks.${task.id}.state`,
        text: String(task.state),
      });

      const strings: string[] = [];
      flattenStrings(task.output, strings);
      if (strings.length > 0) {
        catalog.push({
          ref: `task:${task.id}:output`,
          location: `${workflow.workflowId}.tasks.${task.id}.output`,
          text: truncateText(strings.join('\n'), maxChars),
        });
      }
    }
  }

  return catalog;
}

function isResilienceSplitScenario(scenario: string): boolean {
  return RESILIENCE_ONLY_SCENARIOS.has(scenario);
}

export function runDeterministicResilienceValidator(
  scenario: string,
  result: ScenarioExecutionResult,
  evidence: ScenarioDeliveryEvidence[],
): DeterministicValidatorResult | undefined {
  if (!isResilienceSplitScenario(scenario)) {
    return undefined;
  }

  const checks: DeterministicCheckResult[] = [];
  const validations = new Set(result.validations);

  const forbiddenValidations = result.validations.filter((validation) =>
    FORBIDDEN_PASS_VALIDATIONS.has(validation),
  );

  checks.push({
    checkId: 'resilience.forbidden-pass-validation-absent',
    status: forbiddenValidations.length === 0 ? 'PASS' : 'NOT_PASS',
    rationale:
      forbiddenValidations.length === 0
        ? 'No forbidden pass-only timeout bypass validations were reported'
        : `Forbidden pass-only validation(s) observed: ${forbiddenValidations.join(', ')}`,
    evidenceRefs: ['scenario:resilience:validations'],
  });

  const hasNoHangSignal =
    validations.has('resilience_no_hang_within_timeout') ||
    validations.has('resilience_poll_completed_within_timeout');

  checks.push({
    checkId: 'resilience.no-hang-timeout-bound',
    status: hasNoHangSignal ? 'PASS' : 'NOT_PASS',
    rationale: hasNoHangSignal
      ? 'Scenario reported completion of timeout-bounded polling (no hang/crash signal)'
      : 'Missing timeout-bounded polling signal for resilience verification',
    evidenceRefs: ['scenario:resilience:validations'],
  });

  const hasFailedTaskSignal =
    validations.has('resilience_failed_task_observed') ||
    validations.has('task_failure_detected') ||
    evidence.some((workflow) => workflow.tasks.some((task) => task.state === 'failed'));

  checks.push({
    checkId: 'resilience.failure-path-observed',
    status: hasFailedTaskSignal ? 'PASS' : 'NOT_PASS',
    rationale: hasFailedTaskSignal
      ? 'At least one failed task was observed before retry'
      : 'No failed task evidence found; resilience failure path not demonstrated',
    evidenceRefs: ['scenario:resilience:validations'],
  });

  const retryControlInvoked =
    validations.has('resilience_retry_control_invoked') || validations.has('task_retry_succeeds');

  checks.push({
    checkId: 'resilience.retry-control-invoked',
    status: retryControlInvoked ? 'PASS' : 'NOT_PASS',
    rationale: retryControlInvoked
      ? 'Retry control action was invoked successfully'
      : 'Retry control action signal missing',
    evidenceRefs: ['scenario:resilience:validations'],
  });

  const retryReadyObserved =
    validations.has('resilience_retry_transition_ready') ||
    validations.has('retried_task_ready') ||
    evidence.some((workflow) => workflow.tasks.some((task) => task.state === 'ready'));

  checks.push({
    checkId: 'resilience.retry-transitions-ready',
    status: retryReadyObserved ? 'PASS' : 'NOT_PASS',
    rationale: retryReadyObserved
      ? 'Retried task transitioned back to ready'
      : 'No evidence that retried task transitioned to ready',
    evidenceRefs: ['scenario:resilience:validations'],
  });

  const status: AuthenticityStatus = checks.every((check) => check.status === 'PASS')
    ? 'PASS'
    : 'NOT_PASS';

  return { status, checks };
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

  const requiresSyntheticSignature = SYNTHETIC_SIGNATURE_SCENARIOS.has(scenario);
  if (requiresSyntheticSignature) {
    checks.push({
      checkId: 'synthetic-signature.evidence-present',
      status: evidence.length > 0 ? 'PASS' : 'NOT_PASS',
      rationale:
        evidence.length > 0
          ? 'Scenario included delivery evidence required for synthetic signature verification'
          : 'Scenario missing delivery evidence for deterministic synthetic signature verification',
      evidenceRefs: evidence.length > 0 ? [`scenario:${scenario}:evidence`] : [`scenario:${scenario}:validations`],
    });
  }

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

  for (const workflow of evidence) {
    checks.push({
      checkId: `acceptance-structure.workflow:${workflow.workflowId}`,
      status:
        workflow.acceptanceCriteria.length > 0 &&
        workflow.tasks.length > 0 &&
        Boolean(workflow.workflowState)
          ? 'PASS'
          : 'NOT_PASS',
      rationale:
        workflow.acceptanceCriteria.length > 0 &&
        workflow.tasks.length > 0 &&
        Boolean(workflow.workflowState)
          ? 'Workflow evidence includes acceptance criteria, task list, and terminal state snapshot'
          : 'Workflow evidence missing acceptance criteria, tasks, or state',
      evidenceRefs: [`workflow:${workflow.workflowId}:state`],
    });

    const completedTasks = workflow.tasks.filter((task) => task.state === 'completed');
    const completedOutputsOk = completedTasks.every(
      (task) =>
        task.output && typeof task.output === 'object' && Object.keys(task.output).length > 0,
    );

    checks.push({
      checkId: `acceptance-structure.completed-task-output:${workflow.workflowId}`,
      status: completedOutputsOk ? 'PASS' : 'NOT_PASS',
      rationale: completedOutputsOk
        ? `All ${completedTasks.length} completed tasks include non-empty output objects`
        : 'One or more completed tasks have missing/empty output objects',
      evidenceRefs: completedTasks.map((task) => `task:${task.id}:output`),
    });

    if (requiresSyntheticSignature) {
      const allowedHandlers = ALLOWED_SYNTHETIC_HANDLERS[scenario] ?? new Set<string>();
      const invalidSignatureRefs: string[] = [];

      for (const task of completedTasks) {
        const taskRole = task.role ?? 'unknown-role';
        const output = task.output;

        if (!output || typeof output !== 'object' || Array.isArray(output)) {
          invalidSignatureRefs.push(`task:${task.id}:output`);
          continue;
        }

        const record = output as Record<string, unknown>;
        const hasScenario = record.scenario === scenario;
        const hasTask = record.task_id === task.id;
        const hasWorkflow = record.workflow_id === workflow.workflowId;
        const hasRole = record.role === taskRole;
        const handledBy = typeof record.handled_by === 'string' ? record.handled_by : '';
        const hasAllowedHandler =
          allowedHandlers.size === 0 ? handledBy.length > 0 : allowedHandlers.has(handledBy);

        if (!(hasScenario && hasTask && hasWorkflow && hasRole && hasAllowedHandler)) {
          invalidSignatureRefs.push(`task:${task.id}:output`);
        }
      }

      checks.push({
        checkId: `synthetic-signature.integrity:${workflow.workflowId}`,
        status: invalidSignatureRefs.length === 0 ? 'PASS' : 'NOT_PASS',
        rationale:
          invalidSignatureRefs.length === 0
            ? 'All completed task outputs carry deterministic synthetic execution signatures'
            : 'One or more completed task outputs failed deterministic synthetic signature checks',
        evidenceRefs:
          invalidSignatureRefs.length > 0
            ? invalidSignatureRefs
            : completedTasks.map((task) => `task:${task.id}:output`),
      });
    }

    const placeholderRefs: string[] = [];
    const fallbackStubRefs: string[] = [];

    for (const task of workflow.tasks) {
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
      checkId: `placeholder-rejection.output-markers:${workflow.workflowId}`,
      status: placeholderRefs.length === 0 ? 'PASS' : 'NOT_PASS',
      rationale:
        placeholderRefs.length === 0
          ? 'No placeholder/template markers detected in delivery outputs'
          : 'Detected placeholder/template markers in task output',
      evidenceRefs:
        placeholderRefs.length > 0 ? placeholderRefs : [`workflow:${workflow.workflowId}:state`],
    });

    checks.push({
      checkId: `placeholder-rejection.fallback-stub:${workflow.workflowId}`,
      status: fallbackStubRefs.length === 0 ? 'PASS' : 'NOT_PASS',
      rationale:
        fallbackStubRefs.length === 0
          ? 'No synthetic fallback stub output envelope detected'
          : 'Detected synthetic fallback stub output envelope (task_id + handled_by + status)',
      evidenceRefs:
        fallbackStubRefs.length > 0 ? fallbackStubRefs : [`workflow:${workflow.workflowId}:state`],
    });

    const simulationRefs: string[] = [];
    for (const task of workflow.tasks) {
      const output = task.output;
      if (!output || typeof output !== 'object' || Array.isArray(output)) {
        continue;
      }

      const outputRecord = output as Record<string, unknown>;
      const executionMode =
        typeof outputRecord.execution_mode === 'string'
          ? outputRecord.execution_mode.toLowerCase()
          : '';
      const authenticityGateHint =
        typeof outputRecord.authenticity_gate_hint === 'string'
          ? outputRecord.authenticity_gate_hint.toUpperCase()
          : '';
      const simulatedFlag = outputRecord.simulated === true;
      const simulatedExecutionMode = executionMode.startsWith('simulated');
      const explicitNotPassHint = authenticityGateHint === 'NOT_PASS';

      if (simulatedFlag || simulatedExecutionMode || explicitNotPassHint) {
        simulationRefs.push(`task:${task.id}:output`);
      }
    }

    checks.push({
      checkId: `simulation-rejection.execution-backed:${workflow.workflowId}`,
      status: simulationRefs.length === 0 ? 'PASS' : 'NOT_PASS',
      rationale:
        simulationRefs.length === 0
          ? 'No explicit simulation markers detected in task output envelopes'
          : 'Detected explicit simulation markers; authenticity gate must fail closed for non execution-backed outputs',
      evidenceRefs:
        simulationRefs.length > 0 ? simulationRefs : [`workflow:${workflow.workflowId}:state`],
    });

    if (workflow.requiresGitDiffEvidence) {
      const outputBlob = workflow.tasks.map((task) => JSON.stringify(task.output ?? {})).join('\n');
      const hasGitEvidence = CODE_EVIDENCE_PATTERN.test(outputBlob);
      checks.push({
        checkId: `git-diff-linkage:${workflow.workflowId}`,
        status: hasGitEvidence ? 'PASS' : 'NOT_PASS',
        rationale: hasGitEvidence
          ? 'Found git/diff or file-level change evidence in delivery outputs'
          : 'No git/diff or file-level change evidence found for a scenario requiring code-change linkage',
        evidenceRefs: hasGitEvidence
          ? workflow.tasks.map((task) => `task:${task.id}:output`)
          : [`workflow:${workflow.workflowId}:state`],
      });
    }

    for (const requiredArtifactPath of workflow.requiredArtifacts ?? []) {
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

const EVIDENCE_REF_ALIASABLE_CHECK_PREFIXES = [
  'acceptance-structure.',
  'placeholder-rejection.',
  'simulation-rejection.',
  'git-diff-linkage',
  'resilience.',
] as const;

function isAliasableCheckId(checkId: string): boolean {
  return EVIDENCE_REF_ALIASABLE_CHECK_PREFIXES.some((prefix) => checkId.startsWith(prefix));
}

function buildDeterministicEvidenceAliasMap(
  deterministic: DeterministicValidatorResult,
  validRefs: Set<string>,
): Map<string, string> {
  const aliasMap = new Map<string, string>();
  const baseAliases = new Map<string, string>();
  const ambiguousBaseAliases = new Set<string>();

  for (const check of deterministic.checks) {
    const canonicalRef = check.evidenceRefs.find((ref) => validRefs.has(ref));
    if (!canonicalRef) continue;

    aliasMap.set(check.checkId, canonicalRef);

    if (!isAliasableCheckId(check.checkId)) continue;

    const splitIndex = check.checkId.lastIndexOf(':');
    if (splitIndex <= 0) continue;

    const baseCheckId = check.checkId.slice(0, splitIndex);
    const existing = baseAliases.get(baseCheckId);
    if (!existing) {
      baseAliases.set(baseCheckId, canonicalRef);
      continue;
    }
    if (existing !== canonicalRef) {
      ambiguousBaseAliases.add(baseCheckId);
    }
  }

  for (const [baseCheckId, canonicalRef] of baseAliases.entries()) {
    if (!ambiguousBaseAliases.has(baseCheckId)) {
      aliasMap.set(baseCheckId, canonicalRef);
    }
  }

  return aliasMap;
}

function candidateRefForms(ref: string): string[] {
  const trimmed = ref.trim();
  if (!trimmed) return [];

  const forms = new Set<string>([trimmed]);
  forms.add(trimmed.replace(/^["'`]+|["'`]+$/g, ''));
  forms.add(trimmed.replace(/[.,;]+$/g, ''));

  return Array.from(forms).filter((value) => value.length > 0);
}

function normalizeCanonicalEvidenceAlias(
  candidate: string,
  validRefs: Set<string>,
  aliasMap: Map<string, string>,
): string | undefined {
  const workflowStateMatch = candidate.match(/^workflow:([^:]+)$/);
  if (workflowStateMatch) {
    const resolved = `workflow:${workflowStateMatch[1]}:state`;
    if (validRefs.has(resolved)) {
      return resolved;
    }
  }

  const placeholderWildcardMatch = candidate.match(/^placeholder-rejection\.\*:(.+)$/);
  if (placeholderWildcardMatch) {
    const workflowId = placeholderWildcardMatch[1];
    const resolved =
      aliasMap.get(`placeholder-rejection.output-markers:${workflowId}`) ??
      aliasMap.get(`placeholder-rejection.fallback-stub:${workflowId}`) ??
      aliasMap.get('placeholder-rejection.output-markers') ??
      aliasMap.get('placeholder-rejection.fallback-stub');
    if (resolved && validRefs.has(resolved)) {
      return resolved;
    }
  }

  const gitDiffLinkageMatch = candidate.match(/^git-diff-linkage:(.+)$/);
  if (gitDiffLinkageMatch) {
    const workflowId = gitDiffLinkageMatch[1];
    const resolved = aliasMap.get(`git-diff-linkage:${workflowId}`) ?? aliasMap.get('git-diff-linkage');
    if (resolved && validRefs.has(resolved)) {
      return resolved;
    }
  }

  return undefined;
}

function preferredTaskEvidenceSuffixByCheckId(checkId: string): 'output' | 'state' | undefined {
  if (checkId.startsWith('acceptance-structure.completed-task-output')) {
    return 'output';
  }

  if (checkId.startsWith('placeholder-rejection.')) {
    return 'output';
  }

  if (checkId.startsWith('simulation-rejection.')) {
    return 'output';
  }

  if (checkId.startsWith('git-diff-linkage')) {
    return 'output';
  }

  if (checkId.startsWith('resilience.')) {
    return 'state';
  }

  return undefined;
}

function normalizeTaskIdentity(taskId: string): string {
  return taskId.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findCanonicalTaskRefs(
  taskId: string,
  validRefs: Set<string>,
): { stateRef?: string; outputRef?: string } {
  const directStateRef = `task:${taskId}:state`;
  const directOutputRef = `task:${taskId}:output`;

  if (validRefs.has(directStateRef) || validRefs.has(directOutputRef)) {
    return {
      stateRef: validRefs.has(directStateRef) ? directStateRef : undefined,
      outputRef: validRefs.has(directOutputRef) ? directOutputRef : undefined,
    };
  }

  const normalizedTaskId = normalizeTaskIdentity(taskId);
  if (!normalizedTaskId) {
    return {};
  }

  let stateRef: string | undefined;
  let outputRef: string | undefined;

  for (const ref of validRefs) {
    const match = ref.match(/^task:([^:]+):(state|output)$/);
    if (!match) {
      continue;
    }

    const [, candidateTaskId, suffix] = match;
    if (normalizeTaskIdentity(candidateTaskId) !== normalizedTaskId) {
      continue;
    }

    if (suffix === 'state') {
      stateRef = ref;
    }

    if (suffix === 'output') {
      outputRef = ref;
    }
  }

  return { stateRef, outputRef };
}

function normalizeTaskEvidenceAlias(
  candidate: string,
  checkId: string,
  validRefs: Set<string>,
): string | undefined {
  const taskMatch = candidate.match(/^task:([^:]+)(?::([^:]+))?$/);
  if (!taskMatch) {
    return undefined;
  }

  const taskId = taskMatch[1];
  const requestedSuffix = taskMatch[2];
  const preferredSuffix = preferredTaskEvidenceSuffixByCheckId(checkId);
  const { stateRef, outputRef } = findCanonicalTaskRefs(taskId, validRefs);

  if (preferredSuffix === 'state' && stateRef) {
    return stateRef;
  }

  if (preferredSuffix === 'output' && outputRef) {
    return outputRef;
  }

  if (requestedSuffix === 'state' && stateRef) {
    return stateRef;
  }

  if (requestedSuffix === 'output' && outputRef) {
    return outputRef;
  }

  if (stateRef && !outputRef) return stateRef;
  if (outputRef && !stateRef) return outputRef;

  // Ambiguous task refs are fail-closed unless deterministic check semantics
  // provide a specific suffix preference.
  return undefined;
}

function normalizeEvidenceRef(
  ref: string,
  checkId: string,
  validRefs: Set<string>,
  aliasMap: Map<string, string>,
): string | undefined {
  for (const candidate of candidateRefForms(ref)) {
    if (validRefs.has(candidate)) return candidate;

    const alias = aliasMap.get(candidate);
    if (alias && validRefs.has(alias)) {
      return alias;
    }

    const canonicalAlias = normalizeCanonicalEvidenceAlias(candidate, validRefs, aliasMap);
    if (canonicalAlias) {
      return canonicalAlias;
    }

    const taskAlias = normalizeTaskEvidenceAlias(candidate, checkId, validRefs);
    if (taskAlias) {
      return taskAlias;
    }
  }

  return undefined;
}

function normalizeLlmVerdictEvidenceRefs(
  verdict: LlmValidatorVerdict,
  deterministic: DeterministicValidatorResult,
  validRefs: Set<string>,
): { normalizedVerdict: LlmValidatorVerdict; unknownRefs: string[] } {
  const aliasMap = buildDeterministicEvidenceAliasMap(deterministic, validRefs);
  const unknownRefs: string[] = [];

  const checks = verdict.checks.map((check) => {
    const normalizedRefs: string[] = [];

    for (const ref of check.evidenceRefs) {
      const normalized = normalizeEvidenceRef(ref, check.checkId, validRefs, aliasMap);
      if (!normalized) {
        unknownRefs.push(ref);
        continue;
      }
      if (!normalizedRefs.includes(normalized)) {
        normalizedRefs.push(normalized);
      }
    }

    return {
      ...check,
      evidenceRefs: normalizedRefs,
    };
  });

  return {
    normalizedVerdict: {
      ...verdict,
      checks,
    },
    unknownRefs,
  };
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
    const validRefs = new Set(evidenceCatalog.map((entry) => entry.ref));
    const { normalizedVerdict, unknownRefs } = normalizeLlmVerdictEvidenceRefs(
      verdict,
      deterministic,
      validRefs,
    );
    const allEvidenceRefs = normalizedVerdict.checks.flatMap((check) => check.evidenceRefs);

    if (allEvidenceRefs.length === 0 || unknownRefs.length > 0) {
      return {
        ...baseResult,
        durationMs: Date.now() - startedAt,
        status: 'NOT_PASS',
        output: {
          responseId: response.responseId,
          responseModel: response.responseModel,
          rawText: response.rawText,
          verdict: normalizedVerdict,
        },
        error:
          unknownRefs.length > 0
            ? 'LLM verdict referenced unknown evidence refs (fail-closed)'
            : 'LLM verdict contained no evidence refs (fail-closed)',
      };
    }

    const llmStatus: AuthenticityStatus =
      normalizedVerdict.verdict === 'PASS' &&
      normalizedVerdict.missingEvidenceRefs.length === 0 &&
      normalizedVerdict.checks.every((check) => check.status === 'PASS')
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
        verdict: normalizedVerdict,
      },
      error: llmStatus === 'PASS' ? undefined : normalizedVerdict.summary,
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
  resilience: DeterministicValidatorResult | undefined,
  deliveryQualityStatus: AuthenticityStatus,
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
      resilienceStatus: resilience?.status,
      deliveryQualityStatus,
    },
    validatorInput: {
      validations: input.result.validations,
      artifacts: input.result.artifacts,
      authenticityEvidence: input.result.authenticityEvidence ?? [],
    },
    resilienceValidator: resilience,
    deliveryQualityGate: {
      route,
      status: deliveryQualityStatus,
      deterministicStatus: deterministic.status,
      llmStatus: llm?.status,
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
  const route =
    input.provider === 'none' ? 'deterministic' : resolveScenarioAuthenticityRoute(input.scenario);
  const evidence = input.result.authenticityEvidence ?? [];
  const deterministic = runDeterministicAuthenticityValidator(
    input.scenario,
    input.result,
    evidence,
  );

  const resilience = runDeterministicResilienceValidator(input.scenario, input.result, evidence);

  let llm: LlmValidatorResult | undefined;
  let finalStatus: AuthenticityStatus = 'PASS';
  let deliveryQualityStatus: AuthenticityStatus = deterministic.status;
  let reason: string | undefined;
  const resilienceSplitScenario = isResilienceSplitScenario(input.scenario);

  if (resilience && resilience.status !== 'PASS') {
    finalStatus = 'NOT_PASS';
    reason = 'Deterministic resilience validator returned NOT_PASS';
  }

  if (deterministic.status !== 'PASS') {
    deliveryQualityStatus = 'NOT_PASS';
    finalStatus = 'NOT_PASS';
    reason ??= 'Deterministic delivery-quality validator returned NOT_PASS';
  } else if (resilienceSplitScenario && (!resilience || resilience.status === 'PASS')) {
    // AP-7 / SDLC-sad are resilience-first scenarios. Their expected evidence is a
    // deterministic failed→ready recovery trace, not rich completed-task delivery prose.
    // Treat deterministic delivery checks as authoritative to avoid LLM false negatives
    // caused by intentional failed/pending task states in recovery snapshots.
    deliveryQualityStatus = 'PASS';
  } else if (route === 'hybrid-llm' && (!resilience || resilience.status === 'PASS')) {
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
      deliveryQualityStatus = 'NOT_PASS';
      finalStatus = 'NOT_PASS';
      reason ??= llm.error;
    } else {
      llm = await runLlmAuthenticityValidator(input.scenario, deterministic, evidenceCatalog);
      deliveryQualityStatus = llm.status;
      if (llm.status !== 'PASS') {
        finalStatus = 'NOT_PASS';
        reason ??= llm.error ?? 'LLM delivery-quality validator returned NOT_PASS';
      }
    }
  }

  if (finalStatus !== 'NOT_PASS' && deliveryQualityStatus === 'PASS') {
    finalStatus = 'PASS';
  }

  const artifactPath = writeAuthenticityArtifact(
    input,
    route,
    deterministic,
    llm,
    finalStatus,
    resilience,
    deliveryQualityStatus,
  );

  return {
    status: finalStatus,
    route,
    artifactPath,
    deterministic,
    llm,
    resilience,
    deliveryQualityStatus,
    reason,
  };
}
