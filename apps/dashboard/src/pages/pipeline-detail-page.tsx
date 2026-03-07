import type { Pipeline } from '@agentbaton/sdk';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import {
  dashboardApi,
  type DashboardProjectRecord,
  type DashboardProjectTimelineEntry,
  type DashboardResolvedDocumentReference,
  type DashboardResolvedConfigResponse,
} from '../lib/api.js';
import { subscribeToEvents } from '../lib/sse.js';
import {
  groupTasksByPhase,
  parseOverrideInput,
  parseMemoryValue,
  readPhaseActionDraft,
  readPipelineCurrentPhase,
  readPipelinePhases,
  readPipelineProjectId,
  readProjectMemoryEntries,
  readPipelineRunSummary,
  shouldInvalidatePipelineRealtimeEvent,
  summarizeTasks,
  updatePhaseActionDraft,
  type DashboardPipelineTaskRow,
} from './pipeline-detail-support.js';
import {
  MissionControlCard,
  PipelineHistoryCard,
  ProjectTimelineCard,
  TaskGraphCard,
  WorkflowSwimlanesCard,
} from './pipeline-detail-sections.js';
import { PipelineDocumentsCard, ProjectMemoryCard } from './pipeline-detail-content.js';
import { invalidatePipelineQueries } from './pipeline-detail-query.js';
import { StructuredRecordView } from '../components/structured-data.js';

interface TaskListResult {
  data: DashboardPipelineTaskRow[];
}

export function PipelineDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const pipelineId = params.id ?? '';
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState('Manual pipeline rework requested.');
  const [phaseDrafts, setPhaseDrafts] = useState<Record<string, {
    feedback: string;
    overrideInput: string;
    overrideError: string | null;
  }>>({});
  const [memoryKey, setMemoryKey] = useState('last_operator_note');
  const [memoryValue, setMemoryValue] = useState('{\n  "summary": ""\n}');
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [memoryMessage, setMemoryMessage] = useState<string | null>(null);

  const pipelineQuery = useQuery({
    queryKey: ['pipeline', pipelineId],
    queryFn: () => dashboardApi.getPipeline(pipelineId) as Promise<Pipeline>,
    enabled: pipelineId.length > 0,
  });
  const taskQuery = useQuery({
    queryKey: ['tasks', pipelineId],
    queryFn: () => dashboardApi.listTasks({ pipeline_id: pipelineId }) as Promise<TaskListResult>,
    enabled: pipelineId.length > 0,
  });
  const historyQuery = useQuery({
    queryKey: ['pipeline-history', pipelineId],
    queryFn: () => dashboardApi.listEvents({ entity_type: 'pipeline', entity_id: pipelineId, per_page: '20' }),
    enabled: pipelineId.length > 0,
  });
  const configQuery = useQuery({
    queryKey: ['pipeline-config', pipelineId],
    queryFn: () =>
      dashboardApi.getResolvedPipelineConfig(pipelineId, true) as Promise<DashboardResolvedConfigResponse>,
    enabled: pipelineId.length > 0,
  });

  const projectId = readPipelineProjectId(pipelineQuery.data);
  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => dashboardApi.getProject(projectId ?? '') as Promise<DashboardProjectRecord>,
    enabled: Boolean(projectId),
  });
  const documentQuery = useQuery({
    queryKey: ['pipeline-documents', pipelineId],
    queryFn: () =>
      dashboardApi.listPipelineDocuments(pipelineId) as Promise<DashboardResolvedDocumentReference[]>,
    enabled: pipelineId.length > 0,
  });
  const timelineQuery = useQuery({
    queryKey: ['project-timeline', projectId],
    queryFn: () =>
      dashboardApi.getProjectTimeline(projectId ?? '') as Promise<DashboardProjectTimelineEntry[]>,
    enabled: Boolean(projectId),
  });

  useEffect(() => {
    if (!pipelineId) {
      return;
    }

    return subscribeToEvents((eventType, payload) => {
      if (!shouldInvalidatePipelineRealtimeEvent(eventType, pipelineId, payload)) {
        return;
      }
      void invalidatePipelineQueries(queryClient, pipelineId, projectId);
    });
  }, [pipelineId, projectId, queryClient]);

  const summary = useMemo(() => summarizeTasks(taskQuery.data?.data ?? []), [taskQuery.data?.data]);
  const costSummary = useMemo(() => {
    const tasks = taskQuery.data?.data ?? [];
    return tasks.reduce(
      (acc, task) => {
        const typedTask = task as DashboardPipelineTaskRow & { metrics?: { total_cost_usd?: number } };
        acc.totalCostUsd += Number(typedTask.metrics?.total_cost_usd ?? 0);
        return acc;
      },
      { totalCostUsd: 0 },
    );
  }, [taskQuery.data?.data]);
  const phases = useMemo(() => readPipelinePhases(pipelineQuery.data), [pipelineQuery.data]);
  const phaseGroups = useMemo(
    () => groupTasksByPhase(taskQuery.data?.data ?? [], phases),
    [phases, taskQuery.data?.data],
  );
  const runSummary = useMemo(() => readPipelineRunSummary(pipelineQuery.data), [pipelineQuery.data]);
  const currentPhase = readPipelineCurrentPhase(pipelineQuery.data);
  const memoryEntries = useMemo(
    () => readProjectMemoryEntries(projectQuery.data),
    [projectQuery.data],
  );

  async function handlePhaseAction(
    phaseName: string,
    action: 'approve' | 'reject' | 'request_changes',
  ) {
    const draft = readPhaseActionDraft(phaseDrafts, phaseName);
    const parsed = parseOverrideInput(draft.overrideInput);
    if (action === 'request_changes' && parsed.error) {
      setPhaseDrafts((current) => updatePhaseActionDraft(current, phaseName, { overrideError: parsed.error }));
      return;
    }
    setPhaseDrafts((current) => updatePhaseActionDraft(current, phaseName, { overrideError: null }));
    await dashboardApi.actOnPhaseGate(pipelineId, phaseName, {
      action,
      feedback: draft.feedback || undefined,
      override_input: action === 'request_changes' ? parsed.value : undefined,
    });
    await invalidatePipelineQueries(queryClient, pipelineId, projectId);
  }

  async function handlePhaseCancel(phaseName: string) {
    await dashboardApi.cancelPhase(pipelineId, phaseName);
    await invalidatePipelineQueries(queryClient, pipelineId, projectId);
  }

  async function handleMemorySave() {
    const parsed = parseMemoryValue(memoryValue);
    if (!projectId) {
      setMemoryError('Project memory is only available for project-backed pipelines.');
      return;
    }
    if (!memoryKey.trim()) {
      setMemoryError('Memory key must not be empty.');
      return;
    }
    if (parsed.error) {
      setMemoryError(parsed.error);
      return;
    }
    setMemoryError(null);
    setMemoryMessage(null);
    await dashboardApi.patchProjectMemory(projectId, {
      key: memoryKey.trim(),
      value: parsed.value,
    });
    setMemoryMessage(`Updated project memory key '${memoryKey.trim()}'.`);
    await invalidatePipelineQueries(queryClient, pipelineId, projectId);
  }

  return (
    <section className="grid">
      <div className="grid two">
        <div className="card">
          <h2>Pipeline Detail</h2>
          {pipelineQuery.isLoading ? <p>Loading pipeline...</p> : null}
          {pipelineQuery.error ? <p style={{ color: '#dc2626' }}>Failed to load pipeline</p> : null}
          {pipelineQuery.data ? (
            <div className="grid">
              <div className="row">
                <strong>{pipelineQuery.data.name}</strong>
                <span className={`status-badge status-${pipelineQuery.data.state}`}>{pipelineQuery.data.state}</span>
                {currentPhase ? (
                  <span className="status-badge">Current phase: {currentPhase}</span>
                ) : null}
              </div>
              <StructuredRecordView
                data={pipelineQuery.data.context}
                emptyMessage="No pipeline context is available yet."
              />
            </div>
          ) : null}
        </div>

        <MissionControlCard
          pipelineId={pipelineId}
          projectId={projectId}
          summary={summary}
          totalCostUsd={costSummary.totalCostUsd}
          feedback={feedback}
          onFeedbackChange={setFeedback}
          onPause={() => void dashboardApi.pausePipeline(pipelineId).then(() => invalidatePipelineQueries(queryClient, pipelineId, projectId))}
          onResume={() => void dashboardApi.resumePipeline(pipelineId).then(() => invalidatePipelineQueries(queryClient, pipelineId, projectId))}
          onCancel={() => void dashboardApi.cancelPipeline(pipelineId).then(() => invalidatePipelineQueries(queryClient, pipelineId, projectId))}
          onManualRework={() => void dashboardApi.manualReworkPipeline(pipelineId, { feedback }).then(() => invalidatePipelineQueries(queryClient, pipelineId, projectId))}
        />
      </div>

      <WorkflowSwimlanesCard
        phases={phases}
        phaseGroups={phaseGroups}
        getPhaseFeedback={(phaseName) => readPhaseActionDraft(phaseDrafts, phaseName).feedback}
        getOverrideInput={(phaseName) => readPhaseActionDraft(phaseDrafts, phaseName).overrideInput}
        getOverrideError={(phaseName) => readPhaseActionDraft(phaseDrafts, phaseName).overrideError}
        onPhaseFeedbackChange={(phaseName, value) =>
          setPhaseDrafts((current) => updatePhaseActionDraft(current, phaseName, { feedback: value }))
        }
        onOverrideInputChange={(phaseName, value) =>
          setPhaseDrafts((current) => updatePhaseActionDraft(current, phaseName, { overrideInput: value }))
        }
        onApprove={(phaseName) => void handlePhaseAction(phaseName, 'approve')}
        onReject={(phaseName) => void handlePhaseAction(phaseName, 'reject')}
        onRequestChanges={(phaseName) => void handlePhaseAction(phaseName, 'request_changes')}
        onCancelPhase={(phaseName) => void handlePhaseCancel(phaseName)}
      />

      <div className="grid two">
        <div className="card">
          <h3>Resolved Config</h3>
          <p className="muted">Merged template, project, and run configuration for this pipeline.</p>
          {configQuery.isLoading ? <p>Loading config...</p> : null}
          {configQuery.error ? <p style={{ color: '#dc2626' }}>Failed to load resolved config.</p> : null}
          {configQuery.data ? (
            <StructuredRecordView
              data={configQuery.data}
              emptyMessage="No resolved configuration available."
            />
          ) : null}
        </div>

        <div className="card">
          <h3>Run Summary</h3>
          <p className="muted">Continuity summary written into project memory at terminal pipeline state.</p>
          {runSummary ? (
            <StructuredRecordView
              data={runSummary}
              emptyMessage="Run summary becomes available after the pipeline reaches terminal state."
            />
          ) : <p className="muted">Run summary becomes available after the pipeline reaches terminal state.</p>}
        </div>
      </div>

      <div className="grid two">
        <PipelineDocumentsCard
          isLoading={documentQuery.isLoading}
          hasError={Boolean(documentQuery.error)}
          documents={documentQuery.data ?? []}
        />

        <ProjectMemoryCard
          project={projectQuery.data}
          entries={memoryEntries}
          isLoading={projectQuery.isLoading}
          hasError={Boolean(projectQuery.error)}
          memoryKey={memoryKey}
          memoryValue={memoryValue}
          memoryError={memoryError}
          memoryMessage={memoryMessage}
          onMemoryKeyChange={setMemoryKey}
          onMemoryValueChange={setMemoryValue}
          onSave={() => void handleMemorySave()}
        />
      </div>

      <div className="grid two">
        <TaskGraphCard
          tasks={taskQuery.data?.data ?? []}
          phaseGroups={phaseGroups}
          isLoading={taskQuery.isLoading}
          hasError={Boolean(taskQuery.error)}
        />

        <PipelineHistoryCard
          isLoading={historyQuery.isLoading}
          hasError={Boolean(historyQuery.error)}
          events={historyQuery.data?.data ?? []}
        />
      </div>

      {projectId ? (
        <ProjectTimelineCard
          isLoading={timelineQuery.isLoading}
          hasError={Boolean(timelineQuery.error)}
          entries={timelineQuery.data ?? []}
        />
      ) : null}
    </section>
  );
}
