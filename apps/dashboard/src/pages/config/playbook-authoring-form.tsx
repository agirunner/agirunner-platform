import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs.js';
import { dashboardApi } from '../../lib/api.js';
import {
  summarizePlaybookAuthoringDraft,
  validateRoleDrafts,
  validateWorkflowRulesDraft,
  type PlaybookAuthoringDraft,
} from './playbook-authoring-support.js';
import {
  AdvancedWorkflowSection,
  LaunchInputsSection,
  ProcessInstructionsSection,
  TeamRolesSection,
  WorkflowRulesSection,
} from './playbook-authoring-form-sections.js';

interface PlaybookAuthoringFormProps {
  draft: PlaybookAuthoringDraft;
  onChange(next: PlaybookAuthoringDraft): void;
  onClearError(): void;
  onValidationChange?(issues: string[]): void;
}

export function PlaybookAuthoringForm(props: PlaybookAuthoringFormProps): JSX.Element {
  const summary = summarizePlaybookAuthoringDraft(props.draft);
  const [parameterIssues, setParameterIssues] = useState<Record<string, string>>({});
  const roleDefinitionsQuery = useQuery({
    queryKey: ['role-definitions', 'active'],
    queryFn: () => dashboardApi.listRoleDefinitions(),
  });
  const availableRoleNames = (roleDefinitionsQuery.data ?? [])
    .filter((role) => role.is_active)
    .map((role) => role.name)
    .filter((value, index, all) => value.trim().length > 0 && all.indexOf(value) === index)
    .sort((left, right) => left.localeCompare(right));
  const roleValidation = validateRoleDrafts(props.draft.roles, availableRoleNames);
  const workflowRuleValidation = validateWorkflowRulesDraft(props.draft);

  function updateDraft(updater: (current: PlaybookAuthoringDraft) => PlaybookAuthoringDraft): void {
    props.onClearError();
    props.onChange(updater(props.draft));
  }

  useEffect(() => {
    setParameterIssues((current) =>
      Object.fromEntries(
        Object.entries(current).filter(
          ([key]) => readParameterIssueIndex(key) < props.draft.parameters.length,
        ),
      ),
    );
  }, [props.draft.parameters.length]);

  useEffect(() => {
    props.onValidationChange?.([
      ...roleValidation.blockingIssues,
      ...workflowRuleValidation.blockingIssues,
      ...Object.values(parameterIssues).filter(Boolean),
    ]);
  }, [
    parameterIssues,
    props.onValidationChange,
    roleValidation.blockingIssues,
    workflowRuleValidation.blockingIssues,
  ]);

  function updateParameterIssue(
    index: number,
    kind: 'default' | 'mapping',
    issue?: string,
  ): void {
    const issueKey = buildParameterIssueKey(index, kind);
    setParameterIssues((current) => {
      if (!issue) {
        if (!(issueKey in current)) {
          return current;
        }
        const next = { ...current };
        delete next[issueKey];
        return next;
      }
      if (current[issueKey] === issue) {
        return current;
      }
      return { ...current, [issueKey]: issue };
    });
  }

  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader className="space-y-2">
          <CardTitle>Authoring Overview</CardTitle>
          <p className="text-sm text-muted">
            Start with the process the orchestrator must follow, then add only the rules and inputs
            needed to keep execution deterministic.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <OverviewCard
            title="Process"
            lines={[
              summary.hasProcessInstructions ? 'Instructions ready' : 'Add process instructions',
              `${summary.reviewRuleCount} review rules`,
              `${summary.approvalRuleCount} approval rules`,
            ]}
          />
          <OverviewCard
            title="Team and Handoffs"
            lines={[
              `${summary.roleCount} team roles`,
              `${summary.handoffRuleCount} handoff rules`,
              `${summary.checkpointCount} checkpoints`,
            ]}
          />
          <OverviewCard
            title="Inputs"
            lines={[
              `${summary.parameterCount} inputs`,
              `${summary.requiredParameterCount} required`,
              `${summary.secretParameterCount} secret`,
            ]}
          />
          <OverviewCard
            title="Advanced"
            lines={[
              `${summary.columnCount} board columns`,
              `${summary.gatedCheckpointCount} gated checkpoints`,
              `${summary.runtimeOverrideCount} pool overrides`,
            ]}
          />
        </CardContent>
      </Card>

      <Tabs defaultValue="process" className="space-y-4" data-testid="playbook-authoring-tabs">
        <div className="sticky top-4 z-10 -mx-1 rounded-2xl bg-background/95 px-1 py-1 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <TabsList className="grid h-auto w-full gap-2 rounded-xl bg-border/20 p-2 sm:grid-cols-3">
            <TabsTrigger
              value="process"
              className="h-auto min-h-11 w-full justify-start px-4 py-3 text-left"
            >
              <span className="font-medium">Process</span>
            </TabsTrigger>
            <TabsTrigger
              value="inputs"
              className="h-auto min-h-11 w-full justify-start px-4 py-3 text-left"
            >
              <span className="font-medium">Inputs</span>
            </TabsTrigger>
            <TabsTrigger
              value="advanced"
              className="h-auto min-h-11 w-full justify-start px-4 py-3 text-left"
            >
              <span className="font-medium">Advanced</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="process" className="space-y-4">
          <ProcessInstructionsSection draft={props.draft} onChange={updateDraft} />
          <TeamRolesSection
            draft={props.draft}
            onChange={updateDraft}
            availableRoleNames={availableRoleNames}
          />
          <WorkflowRulesSection
            draft={props.draft}
            onChange={updateDraft}
            availableRoleNames={availableRoleNames}
          />
        </TabsContent>

        <TabsContent value="inputs" className="space-y-4">
          <LaunchInputsSection
            draft={props.draft}
            onChange={updateDraft}
            onParameterIssueChange={updateParameterIssue}
          />
        </TabsContent>

        <TabsContent value="advanced" className="space-y-4">
          <AdvancedWorkflowSection draft={props.draft} onChange={updateDraft} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function buildParameterIssueKey(index: number, kind: 'default' | 'mapping'): string {
  return `${index}:${kind}`;
}

function readParameterIssueIndex(issueKey: string): number {
  const [index] = issueKey.split(':', 1);
  return Number.parseInt(index ?? '', 10);
}

function OverviewCard(props: { title: string; lines: string[] }): JSX.Element {
  return (
    <div className="rounded-lg border border-border/70 bg-border/10 p-4">
      <div className="mb-3 text-sm font-medium">{props.title}</div>
      <div className="grid gap-2 text-sm text-muted">
        {props.lines.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
    </div>
  );
}
