import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs.js';
import { dashboardApi } from '../../lib/api.js';
import {
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
          <Card className="border-border/70 bg-card/80 shadow-sm">
            <CardHeader className="space-y-2">
              <CardTitle>Process-first authoring</CardTitle>
              <p className="text-sm text-muted">
                Define the workflow outcome, tell the orchestrator how the process should run, and
                add only the mandatory role, review, approval, and handoff rules needed to keep the
                workflow deterministic.
              </p>
            </CardHeader>
          </Card>
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
