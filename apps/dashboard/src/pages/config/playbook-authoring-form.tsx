import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Badge } from '../../components/ui/badge.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs.js';
import { dashboardApi, type DashboardToolTagRecord } from '../../lib/api.js';
import {
  summarizePlaybookAuthoringDraft,
  type PlaybookAuthoringDraft,
} from './playbook-authoring-support.js';
import {
  BoardColumnsSection,
  type OrchestratorToolOption,
  OrchestratorSection,
  RuntimeAndParametersSection,
  TeamRolesSection,
  WorkflowStagesSection,
} from './playbook-authoring-form-sections.js';

interface PlaybookAuthoringFormProps {
  draft: PlaybookAuthoringDraft;
  onChange(next: PlaybookAuthoringDraft): void;
  onClearError(): void;
  onValidationChange?(issues: string[]): void;
}

export function PlaybookAuthoringForm(props: PlaybookAuthoringFormProps): JSX.Element {
  const summary = summarizePlaybookAuthoringDraft(props.draft);
  const [parameterDefaultIssues, setParameterDefaultIssues] = useState<Record<number, string>>({});
  const roleDefinitionsQuery = useQuery({
    queryKey: ['role-definitions', 'active'],
    queryFn: () => dashboardApi.listRoleDefinitions(),
  });
  const toolTagsQuery = useQuery({
    queryKey: ['tool-tags'],
    queryFn: () => dashboardApi.listToolTags(),
  });
  const availableRoleNames = (roleDefinitionsQuery.data ?? [])
    .filter((role) => role.is_active)
    .map((role) => role.name)
    .filter((value, index, all) => value.trim().length > 0 && all.indexOf(value) === index)
    .sort((left, right) => left.localeCompare(right));
  const availableToolOptions = buildOrchestratorToolOptions(toolTagsQuery.data);

  function updateDraft(updater: (current: PlaybookAuthoringDraft) => PlaybookAuthoringDraft): void {
    props.onClearError();
    props.onChange(updater(props.draft));
  }

  useEffect(() => {
    setParameterDefaultIssues((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([index]) => Number(index) < props.draft.parameters.length),
      ),
    );
  }, [props.draft.parameters.length]);

  useEffect(() => {
    props.onValidationChange?.(Object.values(parameterDefaultIssues).filter(Boolean));
  }, [parameterDefaultIssues, props.onValidationChange]);

  function updateParameterDefaultIssue(index: number, issue?: string): void {
    setParameterDefaultIssues((current) => {
      if (!issue) {
        if (!(index in current)) {
          return current;
        }
        const next = { ...current };
        delete next[index];
        return next;
      }
      if (current[index] === issue) {
        return current;
      }
      return { ...current, [index]: issue };
    });
  }

  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader className="space-y-2">
          <CardTitle>Authoring Overview</CardTitle>
          <p className="text-sm text-muted">
            Review the current board shape, stage gates, launch inputs, and runtime posture before
            editing the detailed sections below.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <OverviewCard
            title="Board"
            lines={[
              `${summary.columnCount} columns`,
              `${summary.blockedColumnCount} blocked lanes`,
              `${summary.terminalColumnCount} terminal lanes`,
            ]}
          />
          <OverviewCard
            title="Stages"
            lines={[
              `${summary.stageCount} stages`,
              `${summary.gatedStageCount} human gates`,
              `${summary.roleCount} team roles`,
            ]}
          />
          <OverviewCard
            title="Launch Inputs"
            lines={[
              `${summary.parameterCount} parameters`,
              `${summary.requiredParameterCount} required`,
              `${summary.secretParameterCount} secret`,
            ]}
          />
          <OverviewCard
            title="Runtime"
            lines={[
              `${summary.runtimeOverrideCount} pool overrides`,
              props.draft.orchestrator.allow_parallel_work_items
                ? 'Parallel work items enabled'
                : 'Parallel work items disabled',
              `Max active tasks ${props.draft.orchestrator.max_active_tasks || 'inherit'}`,
            ]}
          />
        </CardContent>
      </Card>

      <Tabs defaultValue="flow-design" className="space-y-4" data-testid="playbook-authoring-tabs">
        <div className="sticky top-4 z-10 -mx-1 rounded-2xl bg-background/95 px-1 py-1 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <TabsList className="grid h-auto w-full gap-2 rounded-xl bg-border/20 p-2 sm:grid-cols-3">
            <TabsTrigger
              value="flow-design"
              className="h-auto min-h-11 w-full justify-start px-4 py-3 text-left"
            >
              <span className="font-medium">Flow Design</span>
            </TabsTrigger>
            <TabsTrigger
              value="automation-policy"
              className="h-auto min-h-11 w-full justify-start px-4 py-3 text-left"
            >
              <span className="font-medium">Automation Policy</span>
            </TabsTrigger>
            <TabsTrigger
              value="launch-and-runtime"
              className="h-auto min-h-11 w-full justify-start px-4 py-3 text-left"
            >
              <span className="font-medium">Launch and Runtime</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="flow-design" className="space-y-4">
          <TeamRolesSection
            draft={props.draft}
            onChange={updateDraft}
            availableRoleNames={availableRoleNames}
          />
          <BoardColumnsSection draft={props.draft} onChange={updateDraft} />
          <WorkflowStagesSection draft={props.draft} onChange={updateDraft} />
        </TabsContent>

        <TabsContent value="automation-policy" className="space-y-4">
          <OrchestratorSection
            draft={props.draft}
            onChange={updateDraft}
            availableToolOptions={availableToolOptions}
          />
        </TabsContent>

        <TabsContent value="launch-and-runtime" className="space-y-4">
          <RuntimeAndParametersSection
            draft={props.draft}
            onChange={updateDraft}
            onParameterDefaultIssueChange={updateParameterDefaultIssue}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function normalizeToolTags(
  toolTags: DashboardToolTagRecord[] | undefined,
): DashboardToolTagRecord[] {
  return [...(toolTags ?? [])]
    .filter((tag) => tag.id.trim().length > 0)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function buildOrchestratorToolOptions(
  toolTags: DashboardToolTagRecord[] | undefined,
): OrchestratorToolOption[] {
  const requiredToolIds = new Set([
    'create_work_item',
    'update_work_item',
    'create_task',
    'create_workflow',
    'request_gate_approval',
    'advance_stage',
    'complete_workflow',
  ]);
  return normalizeToolTags(toolTags).map((tag) => ({
    ...tag,
    required: requiredToolIds.has(tag.id),
  }));
}

function OverviewCard(props: { title: string; lines: string[] }): JSX.Element {
  return (
    <div className="rounded-lg border border-border/70 bg-border/10 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-sm font-medium">{props.title}</div>
        <Badge variant="outline">{props.lines.length} signals</Badge>
      </div>
      <div className="grid gap-2 text-sm text-muted">
        {props.lines.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
    </div>
  );
}
