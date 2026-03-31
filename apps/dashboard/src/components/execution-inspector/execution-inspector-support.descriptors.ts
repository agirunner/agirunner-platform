interface GovernanceExecutionDescriptor {
  operationLabel: string;
  contextLabel: string;
  headlineSuffix: string;
  nextAction: string;
  signals: string[];
}

interface ContextContinuityDescriptor {
  operationLabel: string;
  contextLabel: string;
  headlineSuffix: string;
  nextAction: string;
  signals: string[];
}

const GOVERNANCE_EXECUTION_DESCRIPTORS: Record<string, GovernanceExecutionDescriptor> = {
  'task.handoff_submitted': {
    operationLabel: 'Handoff submitted',
    contextLabel: 'Handoff packet',
    headlineSuffix: 'submitted specialist handoff',
    nextAction:
      'Review the handoff summary and successor context before reactivating downstream work.',
    signals: ['Governance', 'Handoff'],
  },
  'task.assessment_resolution_applied': {
    operationLabel: 'Assessment resolution applied',
    contextLabel: 'Assessment resolution packet',
    headlineSuffix: 'applied assessment resolution',
    nextAction:
      'Confirm the assessment resolution updated the workflow state you expected before resuming execution.',
    signals: ['Governance', 'Assessment'],
  },
  'task.assessment_resolution_skipped': {
    operationLabel: 'Assessment resolution skipped',
    contextLabel: 'Assessment resolution packet',
    headlineSuffix: 'skipped assessment resolution',
    nextAction:
      'Check why the assessment resolution was skipped before assuming the workflow is ready to continue.',
    signals: ['Governance', 'Assessment'],
  },
  'task.retry_scheduled': {
    operationLabel: 'Retry scheduled',
    contextLabel: 'Retry packet',
    headlineSuffix: 'scheduled retry',
    nextAction:
      'Confirm the retry lane has the right brief, limits, and predecessor context before it reruns.',
    signals: ['Governance', 'Retry'],
  },
  'task.max_rework_exceeded': {
    operationLabel: 'Max rework exceeded',
    contextLabel: 'Rework packet',
    headlineSuffix: 'exceeded rework limit',
    nextAction:
      'Decide whether to escalate, widen the brief, or stop the lane before more rework burns time.',
    signals: ['Governance', 'Rework'],
  },
  'task.escalated': {
    operationLabel: 'Escalated',
    contextLabel: 'Escalation packet',
    headlineSuffix: 'escalated for operator follow-up',
    nextAction:
      'Open the escalation context, resolve the blocker, and record the decision before sending work forward.',
    signals: ['Governance', 'Escalation'],
  },
  'task.agent_escalated': {
    operationLabel: 'Agent escalated',
    contextLabel: 'Escalation packet',
    headlineSuffix: 'escalated to a specialist follow-up lane',
    nextAction:
      'Inspect the specialist escalation target and confirm the follow-up task has enough context to proceed.',
    signals: ['Governance', 'Escalation'],
  },
  'task.escalation_task_created': {
    operationLabel: 'Escalation task created',
    contextLabel: 'Escalation packet',
    headlineSuffix: 'created escalation follow-up',
    nextAction: 'Inspect the new escalation task and confirm ownership, scope, and urgency.',
    signals: ['Governance', 'Escalation'],
  },
  'task.escalation_response_recorded': {
    operationLabel: 'Escalation response recorded',
    contextLabel: 'Escalation packet',
    headlineSuffix: 'recorded escalation response',
    nextAction:
      'Review the response and confirm the downstream task now has enough direction to continue.',
    signals: ['Governance', 'Escalation'],
  },
  'task.escalation_resolved': {
    operationLabel: 'Escalation resolved',
    contextLabel: 'Escalation packet',
    headlineSuffix: 'resolved escalation',
    nextAction:
      'Confirm the blocked lane is ready to resume and that any required follow-up has been captured.',
    signals: ['Governance', 'Escalation'],
  },
  'task.escalation_depth_exceeded': {
    operationLabel: 'Escalation depth exceeded',
    contextLabel: 'Escalation packet',
    headlineSuffix: 'exceeded escalation depth',
    nextAction: 'Stop automatic escalation chaining and decide the next owner manually.',
    signals: ['Governance', 'Escalation'],
  },
};

const CONTEXT_CONTINUITY_DESCRIPTORS: Record<string, ContextContinuityDescriptor> = {
  'runtime.context.warning': {
    operationLabel: 'Context warning',
    contextLabel: 'Context continuity packet',
    headlineSuffix: 'reported context pressure',
    nextAction:
      'Review durable memory, artifact breadcrumbs, and pending checkpoints before the next compaction boundary.',
    signals: ['Continuity', 'Compaction'],
  },
  'runtime.context.compaction.prepare_started': {
    operationLabel: 'Context compaction prepare started',
    contextLabel: 'Context continuity packet',
    headlineSuffix: 'started context compaction prepare',
    nextAction:
      'Check that durable memory writes and a fresh checkpoint are recorded before more history is compacted.',
    signals: ['Continuity', 'Compaction'],
  },
  'runtime.context.compaction.memory_persisted': {
    operationLabel: 'Context compaction memory persisted',
    contextLabel: 'Context continuity packet',
    headlineSuffix: 'persisted pre-compaction memory',
    nextAction:
      'Confirm the recorded memory keys are durable facts rather than temporary status before the run continues.',
    signals: ['Continuity', 'Compaction'],
  },
  'runtime.context.compaction.checkpoint_written': {
    operationLabel: 'Context compaction checkpoint written',
    contextLabel: 'Context continuity packet',
    headlineSuffix: 'wrote compaction checkpoint',
    nextAction:
      'Inspect the checkpoint ref and make sure it captures the transient continuity you expect to survive compaction.',
    signals: ['Continuity', 'Compaction'],
  },
  'runtime.context.compaction.completed': {
    operationLabel: 'Context compaction completed',
    contextLabel: 'Context continuity packet',
    headlineSuffix: 'compacted specialist context',
    nextAction:
      'Inspect the preserved checkpoint, tokens saved, and recent breadcrumbs before assuming older context is still available.',
    signals: ['Continuity', 'Compaction'],
  },
  'runtime.context.compaction.failed': {
    operationLabel: 'Context compaction failed',
    contextLabel: 'Context continuity packet',
    headlineSuffix: 'failed context compaction',
    nextAction:
      'Review the failure packet, then decide whether the step needs retry or manual recovery before more context pressure builds.',
    signals: ['Continuity', 'Compaction', 'Recovery'],
  },
  'runtime.context.activation_finish.prepare_started': {
    operationLabel: 'Activation finish prepare started',
    contextLabel: 'Activation checkpoint packet',
    headlineSuffix: 'started activation finish prepare',
    nextAction:
      'Check the pending checkpoint and continuity state before the orchestrator yields this activation.',
    signals: ['Continuity', 'Activation checkpoint'],
  },
  'runtime.context.activation_finish.memory_persisted': {
    operationLabel: 'Activation finish memory persisted',
    contextLabel: 'Activation checkpoint packet',
    headlineSuffix: 'persisted durable activation memory',
    nextAction:
      'Confirm the saved memory keys are durable facts that the next activation may need to recover quickly.',
    signals: ['Continuity', 'Activation checkpoint'],
  },
  'runtime.context.activation_finish.continuity_persisted': {
    operationLabel: 'Activation finish continuity persisted',
    contextLabel: 'Activation checkpoint packet',
    headlineSuffix: 'persisted activation continuity',
    nextAction:
      'Review the work-item continuity update before assuming the next activation has enough routing context.',
    signals: ['Continuity', 'Activation checkpoint'],
  },
  'runtime.context.activation_finish.checkpoint_persisted': {
    operationLabel: 'Activation checkpoint persisted',
    contextLabel: 'Activation checkpoint packet',
    headlineSuffix: 'persisted activation checkpoint',
    nextAction:
      'Inspect the checkpoint ref and confirm the next activation can recover the working state from it.',
    signals: ['Continuity', 'Activation checkpoint'],
  },
  'runtime.context.activation_finish.completed': {
    operationLabel: 'Activation finish completed',
    contextLabel: 'Activation checkpoint packet',
    headlineSuffix: 'persisted activation checkpoint',
    nextAction:
      'Confirm the activation checkpoint, continuity update, and durable memory writes before the next orchestrator activation starts.',
    signals: ['Continuity', 'Activation checkpoint'],
  },
  'runtime.context.activation_finish.failed': {
    operationLabel: 'Activation finish failed',
    contextLabel: 'Activation checkpoint packet',
    headlineSuffix: 'failed activation finish persistence',
    nextAction:
      'Review the failed persistence step before trusting the next activation to inherit the current working state.',
    signals: ['Continuity', 'Activation checkpoint', 'Recovery'],
  },
};

export function readGovernanceExecutionDescriptor(
  operation: string,
): GovernanceExecutionDescriptor | null {
  return GOVERNANCE_EXECUTION_DESCRIPTORS[operation] ?? null;
}

export function readContextContinuityDescriptor(
  operation: string,
): ContextContinuityDescriptor | null {
  return CONTEXT_CONTINUITY_DESCRIPTORS[operation] ?? null;
}
