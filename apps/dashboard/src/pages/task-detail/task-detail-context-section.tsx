import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { StructuredRecordView } from '../../components/structured-data/structured-data.js';
import {
  readClarificationAnswers,
  readClarificationHistory,
  readExecutionSummary,
  readHumanEscalationResponse,
  readAssessmentSignals,
} from './task-detail-support.js';
import {
  buildActivationCheckpointPacket,
  buildClarificationPacket,
  buildContinuityHighlightFacts,
  buildEscalationPacket,
  buildExecutionPacket,
  buildPreviewFacts,
  type TaskContextFact,
} from './task-detail-context-support.js';

interface TaskDetailContextTask {
  input?: Record<string, unknown>;
  context?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  verification?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  workflow_name?: string;
  workflow_id?: string;
  stage_name?: string | null;
  work_item_id?: string | null;
  activation_id?: string | null;
  execution_backend?: 'runtime_only' | 'runtime_plus_task' | null;
  used_task_sandbox?: boolean;
  type?: string;
}

export function TaskDetailContextSection({
  task,
  status,
  summarizeId,
}: {
  task: TaskDetailContextTask;
  status: string;
  summarizeId: (value?: string | null) => string;
}): JSX.Element {
  const clarificationAnswers = readClarificationAnswers(task as never);
  const clarificationHistory = readClarificationHistory(task as never);
  const escalationResponse = readHumanEscalationResponse(task as never);
  const executionSummary = readExecutionSummary(task as never);
  const assessmentSignals = readAssessmentSignals(task as never);
  const runtimeContext = asRecord(task.context);
  const activationCheckpoint = asRecord(asRecord(task.metadata).last_activation_checkpoint);

  const clarificationPacket = buildClarificationPacket({
    answers: clarificationAnswers,
    history: clarificationHistory,
  });
  const escalationPacket = buildEscalationPacket({
    escalationResponse,
    reviewSignals: assessmentSignals,
  });
  const executionPacket = buildExecutionPacket({
    verification: executionSummary.verification,
    metrics: executionSummary.metrics,
    runtimeContext,
  });
  const continuityHighlights = buildContinuityHighlightFacts({
    metrics: executionSummary.metrics,
    activationCheckpoint,
  });
  const activationCheckpointPacket = buildActivationCheckpointPacket(activationCheckpoint);

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Operator packet</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <TaskPacketCard
            title="Current status"
            summary={`This step is ${status.replace(/_/g, ' ')}${task.stage_name ? ` in stage ${task.stage_name}` : ''}. ${task.work_item_id ? `It is attached to work item ${summarizeId(task.work_item_id)}.` : 'No work item is linked yet.'}`}
            facts={[
              { label: 'Board', value: task.workflow_name ?? summarizeId(task.workflow_id) },
              { label: 'Stage', value: task.stage_name ?? 'No stage recorded' },
              { label: 'Work item', value: summarizeId(task.work_item_id) },
              { label: 'Activation', value: summarizeId(task.activation_id) },
              {
                label: 'Execution backend',
                value:
                  task.execution_backend === 'runtime_only'
                    ? 'Runtime-only'
                    : 'Runtime + task sandbox',
              },
              {
                label: 'Task sandbox',
                value:
                  task.execution_backend === 'runtime_only'
                    ? 'No task sandbox'
                    : task.used_task_sandbox
                      ? 'Used task sandbox'
                      : 'No task sandbox used',
              },
            ]}
          />
          <TaskPacketCard
            title="Clarifications"
            summary={clarificationPacket.summary}
            facts={clarificationPacket.facts}
            previewFacts={buildPreviewFacts(clarificationAnswers)}
            previewLabel="Current answers"
            disclosureTitle="View clarification answers"
            disclosureContent={
              <StructuredRecordView
                data={clarificationAnswers}
                emptyMessage="No clarification answers recorded."
              />
            }
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <TaskPacketCard
          id="escalation-response"
          title="Escalation path"
          summary={escalationPacket.summary}
          facts={escalationPacket.facts}
          previewFacts={buildPreviewFacts(escalationResponse)}
          previewLabel="Recorded human guidance"
          disclosureTitle="View escalation response"
          disclosureContent={
            <StructuredRecordView
              data={escalationResponse}
              emptyMessage="No human escalation response recorded."
            />
          }
        />
        <TaskPacketCard
          title="Execution evidence"
          summary={executionPacket.summary}
          facts={executionPacket.facts}
          previewFacts={[
            ...continuityHighlights,
            ...buildPreviewFacts(executionSummary.verification, 2),
            ...buildPreviewFacts(executionSummary.metrics, 2),
          ].slice(0, 4)}
          previewLabel={continuityHighlights.length > 0 ? 'Continuity highlights' : 'Execution highlights'}
        >
          <div className="space-y-3">
            <TaskPacketCard
              title="Activation checkpoint"
              summary={activationCheckpointPacket.summary}
              facts={activationCheckpointPacket.facts}
              previewFacts={buildPreviewFacts(activationCheckpoint, 2)}
              previewLabel="Checkpoint details"
              disclosureTitle="View activation checkpoint"
              disclosureContent={
                <StructuredRecordView
                  data={activationCheckpoint}
                  emptyMessage="No activation checkpoint."
                />
              }
            />
            <ProgressiveDataBlock
              title="Verification evidence"
              disclosureTitle="View verification fields"
              data={executionSummary.verification}
              emptyMessage="No verification data."
            />
            <ProgressiveDataBlock
              title="Execution metrics"
              disclosureTitle="View execution metrics"
              data={executionSummary.metrics}
              emptyMessage="No execution metrics."
            />
            <ProgressiveDataBlock
              title="Runtime context"
              disclosureTitle="View runtime context"
              data={runtimeContext}
              emptyMessage="No runtime context."
            />
          </div>
        </TaskPacketCard>
      </div>

      {clarificationHistory.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Clarification history</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {clarificationHistory.map((entry, index) => (
              <article
                key={`${entry.answered_at ?? 'clarification'}-${index}`}
                className="rounded-xl border border-border/70 bg-card/60 p-4"
              >
                <p className="text-sm font-medium">
                  {entry.feedback ?? 'Clarification request'}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {entry.answered_by ?? 'Unknown responder'}
                  {entry.answered_at ? ` • ${entry.answered_at}` : ''}
                </p>
                <details className="mt-3 rounded-xl border border-border/70 bg-surface p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    View captured answers
                  </summary>
                  <div className="mt-3">
                    <StructuredRecordView
                      data={entry.answers ?? {}}
                      emptyMessage="No answers captured."
                    />
                  </div>
                </details>
              </article>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function TaskPacketCard({
  id,
  title,
  summary,
  facts,
  previewFacts = [],
  previewLabel,
  disclosureTitle,
  disclosureContent,
  children,
}: {
  id?: string;
  title: string;
  summary: string;
  facts: TaskContextFact[];
  previewFacts?: TaskContextFact[];
  previewLabel?: string;
  disclosureTitle?: string;
  disclosureContent?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <Card id={id} className="border-border/70 shadow-sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm leading-6 text-muted">{summary}</p>
        <FactGrid facts={facts} />
        {previewFacts.length > 0 ? (
          <div className="rounded-xl bg-border/10 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              {previewLabel}
            </p>
            <FactGrid className="mt-3" facts={previewFacts} />
          </div>
        ) : null}
        {children}
        {disclosureTitle && disclosureContent ? (
          <details className="rounded-xl border border-border/70 bg-surface p-4">
            <summary className="cursor-pointer text-sm font-medium">{disclosureTitle}</summary>
            <div className="mt-3">{disclosureContent}</div>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ProgressiveDataBlock({
  title,
  disclosureTitle,
  data,
  emptyMessage,
}: {
  title: string;
  disclosureTitle: string;
  data: Record<string, unknown>;
  emptyMessage: string;
}) {
  const previewFacts = buildPreviewFacts(data, 3);

  return (
    <div className="rounded-xl bg-border/10 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{title}</p>
      {previewFacts.length > 0 ? (
        <>
          <FactGrid className="mt-3" facts={previewFacts} />
          <details className="mt-3 rounded-xl border border-border/70 bg-surface p-3">
            <summary className="cursor-pointer text-sm font-medium">{disclosureTitle}</summary>
            <div className="mt-3">
              <StructuredRecordView data={data} emptyMessage={emptyMessage} />
            </div>
          </details>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted">{emptyMessage}</p>
      )}
    </div>
  );
}

function FactGrid({
  facts,
  className = '',
}: {
  facts: TaskContextFact[];
  className?: string;
}) {
  return (
    <dl className={`grid gap-3 sm:grid-cols-2 ${className}`.trim()}>
      {facts.map((fact) => (
        <div key={`${fact.label}:${fact.value}`} className="rounded-xl bg-surface p-3 shadow-sm">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">{fact.label}</dt>
          <dd className="mt-2 text-sm font-medium leading-6">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
