import type { SafetynetEntry } from './types.js';

export const PLATFORM_ORCHESTRATOR_SUBJECT_LINKAGE_INFERENCE_ID =
  'platform.orchestrator.subject_linkage_inference';
export const PLATFORM_ORCHESTRATOR_REWORK_ROUTE_INFERENCE_ID =
  'platform.orchestrator.rework_route_inference';
export const PLATFORM_ORCHESTRATOR_PARENT_WORK_ITEM_DEFAULT_INFERENCE_ID =
  'platform.orchestrator.parent_work_item_default_inference';
export const PLATFORM_ORCHESTRATOR_STAGE_ALIGNMENT_REPAIR_ID =
  'platform.orchestrator.stage_alignment_repair';
export const PLATFORM_ORCHESTRATOR_EXPECTED_TASK_TYPE_INFERENCE_ID =
  'platform.orchestrator.expected_task_type_inference';
export const PLATFORM_ACTIVATION_STALE_RECOVERY_ID =
  'platform.activation.stale_activation_recovery';
export const PLATFORM_CONTROL_PLANE_IDEMPOTENT_MUTATION_REPLAY_ID =
  'platform.control_plane.idempotent_mutation_replay';
export const PLATFORM_CONTROL_PLANE_NOT_READY_NOOP_RECOVERY_ID =
  'platform.control_plane.not_ready_noop_recovery';
export const PLATFORM_HANDOFF_NORMALIZATION_AND_REPLAY_REPAIR_ID =
  'platform.handoff.normalization_and_replay_repair';
export const PLATFORM_CONTINUITY_STALE_WRITE_SUPPRESSION_ID =
  'platform.continuity.stale_write_suppression';
export const PLATFORM_APPROVAL_STALE_DECISION_SUPERSESSION_ID =
  'platform.approval.stale_decision_supersession';
export const PLATFORM_LOGGING_SECRET_REDACTION_ID =
  'platform.logging.secret_redaction';

const entries: SafetynetEntry[] = [
  {
    kind: 'safetynet_behavior',
    id: PLATFORM_ORCHESTRATOR_SUBJECT_LINKAGE_INFERENCE_ID,
    layer: 'platform',
    name: 'Assessment subject linkage inference',
    classification: 'behavior_masking',
    mechanism: 'inference',
    default_policy: 'enabled',
    disposition: 'keep',
    trigger: 'assessment or approval task creation omits explicit subject linkage',
    nominal_contract: 'orchestrator provides explicit subject linkage and revision metadata',
    intervention: 'platform derives missing subject linkage from explicit context or activation lineage',
    risk_if_triggered: 'workflow may appear correct even though orchestrator omitted required linkage metadata',
    operator_visibility: 'must remain reviewable in the safetynet catalog and owner code',
    owner_module: 'src/services/workflow-task-policy/assessment-subject-service.ts',
    test_requirements: ['positive trigger', 'non-trigger path', 'observability emission'],
    metrics_key:
      'platform_safetynet_trigger_total{behavior="platform.orchestrator.subject_linkage_inference"}',
    log_event_type: 'platform.safetynet.triggered',
    review_notes: 'candidate to tighten as explicit subject linkage becomes universal',
    status: 'candidate_for_tightening',
  },
  {
    kind: 'safetynet_behavior',
    id: PLATFORM_ORCHESTRATOR_REWORK_ROUTE_INFERENCE_ID,
    layer: 'platform',
    name: 'Assessment rework route inference',
    classification: 'behavior_masking',
    mechanism: 'inference',
    default_policy: 'enabled',
    disposition: 'keep',
    trigger: 'assessment requested-changes path lacks explicit route_to_role or reopen_subject action',
    nominal_contract: 'playbook outcome actions or explicit control-plane data define the rework target',
    intervention: 'platform infers the rework actor from subject linkage or latest delivery handoff lineage',
    risk_if_triggered: 'rework can proceed even though authored routing data was incomplete',
    operator_visibility: 'must remain reviewable in the safetynet catalog and owner code',
    owner_module: 'src/services/work-item-continuity-service.ts',
    test_requirements: ['positive trigger', 'non-trigger path', 'observability emission'],
    metrics_key:
      'platform_safetynet_trigger_total{behavior="platform.orchestrator.rework_route_inference"}',
    log_event_type: 'platform.safetynet.triggered',
    review_notes: 'candidate to tighten as authored rework routing becomes explicit everywhere',
    status: 'candidate_for_tightening',
  },
  {
    kind: 'safetynet_behavior',
    id: PLATFORM_ORCHESTRATOR_PARENT_WORK_ITEM_DEFAULT_INFERENCE_ID,
    layer: 'platform',
    name: 'Parent work item default inference',
    classification: 'behavior_masking',
    mechanism: 'inference',
    default_policy: 'enabled',
    disposition: 'keep',
    trigger: 'orchestrator create_work_item omits parent_work_item_id and activation context provides a planned-workflow parent candidate',
    nominal_contract: 'orchestrator explicitly supplies the intended parent work item when creating successor work',
    intervention: 'platform infers parent_work_item_id from activation context for bounded planned-workflow successor cases',
    risk_if_triggered: 'successor work can be created even though the orchestrator omitted explicit parent linkage',
    operator_visibility: 'must remain reviewable in the safetynet catalog and owner code',
    owner_module: 'src/api/routes/orchestrator-control/activation-context.ts',
    test_requirements: ['positive trigger', 'non-trigger path', 'observability emission'],
    metrics_key:
      'platform_safetynet_trigger_total{behavior="platform.orchestrator.parent_work_item_default_inference"}',
    log_event_type: 'platform.safetynet.triggered',
    review_notes: 'keep narrow to planned-workflow activation context defaults; do not generalize into free parent guessing',
    status: 'candidate_for_tightening',
  },
  {
    kind: 'safetynet_behavior',
    id: PLATFORM_ORCHESTRATOR_STAGE_ALIGNMENT_REPAIR_ID,
    layer: 'platform',
    name: 'Stage alignment work item repair',
    classification: 'behavior_masking',
    mechanism: 'repair',
    default_policy: 'enabled',
    disposition: 'keep',
    trigger: 'orchestrator create_task targets a work item whose stage does not match the requested stage but a unique stage-aligned parent or child candidate exists',
    nominal_contract: 'orchestrator supplies the exact stage-matching work_item_id for task creation',
    intervention: 'platform repairs the request to a unique stage-aligned work item and records the alignment source',
    risk_if_triggered: 'task creation can succeed even though the submitted work_item_id did not match the requested stage',
    operator_visibility: 'must remain reviewable in the safetynet catalog and owner code',
    owner_module: 'src/api/routes/orchestrator-control/stage-alignment.ts',
    test_requirements: ['positive trigger', 'non-trigger path', 'observability emission'],
    metrics_key:
      'platform_safetynet_trigger_total{behavior="platform.orchestrator.stage_alignment_repair"}',
    log_event_type: 'platform.safetynet.triggered',
    review_notes: 'keep bounded to unique parent/child stage matches only',
    status: 'candidate_for_tightening',
  },
  {
    kind: 'safetynet_behavior',
    id: PLATFORM_ORCHESTRATOR_EXPECTED_TASK_TYPE_INFERENCE_ID,
    layer: 'platform',
    name: 'Expected task type inference',
    classification: 'behavior_masking',
    mechanism: 'inference',
    default_policy: 'enabled',
    disposition: 'keep',
    trigger: 'orchestrator create_task omits type and the target work item explicitly expects an assessment actor/action pair',
    nominal_contract: 'orchestrator supplies the intended task type when creating specialist work',
    intervention: 'platform infers assessment task type from the work-item expectation contract',
    risk_if_triggered: 'assessment task creation can succeed even though the orchestrator omitted explicit task type',
    operator_visibility: 'must remain reviewable in the safetynet catalog and owner code',
    owner_module: 'src/api/routes/orchestrator-control/task-assessment-linkage.ts',
    test_requirements: ['positive trigger', 'non-trigger path', 'observability emission'],
    metrics_key:
      'platform_safetynet_trigger_total{behavior="platform.orchestrator.expected_task_type_inference"}',
    log_event_type: 'platform.safetynet.triggered',
    review_notes: 'keep narrow to explicit assess expectations; do not infer arbitrary task kinds',
    status: 'candidate_for_tightening',
  },
  {
    kind: 'safetynet_behavior',
    id: PLATFORM_ACTIVATION_STALE_RECOVERY_ID,
    layer: 'platform',
    name: 'Stale activation recovery',
    classification: 'protective',
    mechanism: 'retry',
    default_policy: 'enabled',
    disposition: 'keep',
    trigger: 'activation processing is stale because the orchestrator task disappeared and the activation can be safely requeued and redispatched',
    nominal_contract: 'workflow activation processing retains a live orchestrator task until completion or fails explicitly',
    intervention: 'platform requeues the stale activation, records recovery metadata, and redispatches it with delay bypass',
    risk_if_triggered: 'low; preserves progress after partial activation loss instead of leaving the workflow stuck',
    operator_visibility: 'must remain reviewable in the safetynet catalog and owner code',
    owner_module: 'src/services/workflow-activation-dispatch/recovery-runner.ts',
    test_requirements: ['positive trigger', 'non-trigger path', 'observability emission'],
    metrics_key:
      'platform_safetynet_trigger_total{behavior="platform.activation.stale_activation_recovery"}',
    log_event_type: 'platform.safetynet.triggered',
    review_notes: 'keep limited to missing-orchestrator-task stale recovery; do not use for unrelated activation retries',
    status: 'active',
  },
  {
    kind: 'safetynet_behavior',
    id: PLATFORM_CONTROL_PLANE_IDEMPOTENT_MUTATION_REPLAY_ID,
    layer: 'platform',
    name: 'Idempotent mutation replay',
    classification: 'protective',
    mechanism: 'suppression',
    default_policy: 'enabled',
    disposition: 'keep',
    trigger: 'mutating platform request reuses a request_id with an equivalent stored response',
    nominal_contract: 'at-least-once delivery remains safe and returns one logical result',
    intervention: 'platform returns the stored response instead of duplicating the mutation',
    risk_if_triggered: 'low; this is required for idempotent control-plane behavior',
    operator_visibility: 'must remain reviewable in the safetynet catalog and owner code',
    owner_module: 'src/services/task-tool-result-service.ts',
    test_requirements: ['positive trigger', 'non-trigger path', 'observability emission'],
    metrics_key:
      'platform_safetynet_trigger_total{behavior="platform.control_plane.idempotent_mutation_replay"}',
    log_event_type: 'platform.safetynet.triggered',
    review_notes: 'protective idempotency behavior should remain enabled',
    status: 'active',
  },
  {
    kind: 'safetynet_behavior',
    id: PLATFORM_CONTROL_PLANE_NOT_READY_NOOP_RECOVERY_ID,
    layer: 'platform',
    name: 'Recoverable guided mutation recovery',
    classification: 'protective',
    mechanism: 'fallback',
    default_policy: 'enabled',
    disposition: 'keep',
    trigger: 'mutation is not currently legal but can be represented as a benign structured recoverable no-op with next-step guidance',
    nominal_contract: 'platform returns machine-readable recovery guidance instead of failing callers into ad hoc retry logic for recoverable control-plane misses',
    intervention: 'platform returns a structured recoverable guidance payload with readiness or correction details',
    risk_if_triggered: 'low; preserves legality while preventing noisy mutation failures and repeated stale retries',
    operator_visibility: 'recoverable guidance payloads should carry the safetynet id when returned',
    owner_module: 'src/api/routes/orchestrator-control.routes.ts',
    test_requirements: ['positive trigger', 'non-trigger path', 'observability emission'],
    metrics_key:
      'platform_safetynet_trigger_total{behavior="platform.control_plane.not_ready_noop_recovery"}',
    log_event_type: 'platform.safetynet.triggered',
    review_notes: 'keep explicit and limited to recoverable guidance conversions that preserve workflow meaning',
    status: 'active',
  },
  {
    kind: 'safetynet_behavior',
    id: PLATFORM_HANDOFF_NORMALIZATION_AND_REPLAY_REPAIR_ID,
    layer: 'platform',
    name: 'Handoff normalization and replay repair',
    classification: 'behavior_masking',
    mechanism: 'repair',
    default_policy: 'enabled',
    disposition: 'keep',
    trigger: 'handoff submission requires normalization, stable path canonicalization, or replay reconciliation to remain legal',
    nominal_contract: 'agent submits a fully normalized, attempt-correct handoff payload that already uses stable output references',
    intervention: 'platform normalizes handoff state, repairs task-local path references into stable operator-facing references when safe, and reconciles editable replay state',
    risk_if_triggered: 'handoff success can hide that the submitted payload was incomplete, used unstable output references, or replayed imperfectly',
    operator_visibility: 'must remain reviewable in the safetynet catalog and owner code',
    owner_module: 'src/services/handoff-service.ts',
    test_requirements: ['positive trigger', 'non-trigger path', 'observability emission'],
    metrics_key:
      'platform_safetynet_trigger_total{behavior="platform.handoff.normalization_and_replay_repair"}',
    log_event_type: 'platform.safetynet.triggered',
    review_notes: 'keep narrow and visible; normalization may only canonicalize safe output references and replay state, not invent workflow meaning',
    status: 'candidate_for_tightening',
  },
  {
    kind: 'safetynet_behavior',
    id: PLATFORM_CONTINUITY_STALE_WRITE_SUPPRESSION_ID,
    layer: 'platform',
    name: 'Continuity stale write suppression',
    classification: 'protective',
    mechanism: 'suppression',
    default_policy: 'enabled',
    disposition: 'keep',
    trigger: 'older continuity or finish-state write would overwrite newer specialist progress',
    nominal_contract: 'stale continuity writes must not win over newer workflow state',
    intervention: 'platform skips the stale write and preserves the newer continuity state',
    risk_if_triggered: 'low; protects ordering correctness in concurrent or retried flows',
    operator_visibility: 'must remain reviewable in the safetynet catalog and owner code',
    owner_module: 'src/services/work-item-continuity-service.ts',
    test_requirements: ['positive trigger', 'non-trigger path', 'observability emission'],
    metrics_key:
      'platform_safetynet_trigger_total{behavior="platform.continuity.stale_write_suppression"}',
    log_event_type: 'platform.safetynet.triggered',
    review_notes: 'protective concurrency guard should remain enabled',
    status: 'active',
  },
  {
    kind: 'safetynet_behavior',
    id: PLATFORM_APPROVAL_STALE_DECISION_SUPERSESSION_ID,
    layer: 'platform',
    name: 'Stale approval decision supersession',
    classification: 'protective',
    mechanism: 'suppression',
    default_policy: 'enabled',
    disposition: 'keep',
    trigger: 'older gate decision exists after a newer subject revision supersedes it',
    nominal_contract: 'older human approvals remain historical but cannot clear current revision state',
    intervention: 'platform marks prior decisions superseded while preserving audit history',
    risk_if_triggered: 'low; prevents stale approvals from unlocking current work incorrectly',
    operator_visibility: 'must remain reviewable in the safetynet catalog and owner code',
    owner_module: 'src/services/workflow-stage/workflow-stage-gate-revisions.ts',
    test_requirements: ['positive trigger', 'non-trigger path', 'observability emission'],
    metrics_key:
      'platform_safetynet_trigger_total{behavior="platform.approval.stale_decision_supersession"}',
    log_event_type: 'platform.safetynet.triggered',
    review_notes: 'protective approval supersession should remain enabled',
    status: 'active',
  },
  {
    kind: 'safetynet_behavior',
    id: PLATFORM_LOGGING_SECRET_REDACTION_ID,
    layer: 'platform',
    name: 'Platform secret redaction',
    classification: 'protective',
    mechanism: 'redaction',
    default_policy: 'enabled',
    disposition: 'keep',
    trigger: 'platform log or response payload contains secret-like material',
    nominal_contract: 'plaintext secrets must never be persisted or returned from platform services',
    intervention: 'platform redacts secret-like fields before persistence or response shaping',
    risk_if_triggered: 'low; expected protective behavior',
    operator_visibility: 'must remain reviewable in the safetynet catalog and owner code',
    owner_module: 'src/services/secret-redaction.ts',
    test_requirements: ['positive trigger', 'non-trigger path', 'observability emission'],
    metrics_key:
      'platform_safetynet_trigger_total{behavior="platform.logging.secret_redaction"}',
    log_event_type: 'platform.safetynet.triggered',
    review_notes: 'protective redaction must remain enabled',
    status: 'active',
  },
];

const entriesById = new Map(entries.map((entry) => [entry.id, entry] as const));

export function listSafetynetEntries(): SafetynetEntry[] {
  return entries.map((entry) => ({ ...entry, test_requirements: [...entry.test_requirements] }));
}

export function getSafetynetEntry(id: string): SafetynetEntry | null {
  return entriesById.get(id) ?? null;
}

export function mustGetSafetynetEntry(id: string): SafetynetEntry {
  const entry = getSafetynetEntry(id);
  if (!entry) {
    throw new Error(`unknown platform safetynet entry '${id}'`);
  }
  return entry;
}
