import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../components/ui/tabs.js';
import { dashboardApi } from '../../../lib/api.js';
import {
  validateParameterDrafts,
  validateRoleDrafts,
  validateWorkflowRulesDraft,
  type PlaybookAuthoringDraft,
} from './playbook-authoring-support.js';
import {
  AdvancedWorkflowSection,
  LaunchInputsSection,
  ProcessInstructionsSection,
  TeamRolesSection,
  WorkflowStagesSection,
} from './playbook-authoring-form-sections.js';

interface PlaybookAuthoringFormProps {
  draft: PlaybookAuthoringDraft;
  showValidationErrors?: boolean;
  onChange(next: PlaybookAuthoringDraft): void;
  onClearError(): void;
  onValidationChange?(issues: string[]): void;
}

export function PlaybookAuthoringForm(props: PlaybookAuthoringFormProps): JSX.Element {
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
    props.onValidationChange?.([
      ...roleValidation.blockingIssues,
      ...workflowRuleValidation.blockingIssues,
      ...validateParameterDrafts(props.draft.parameters).blockingIssues,
    ]);
  }, [
    props.draft.parameters,
    props.onValidationChange,
    roleValidation.blockingIssues,
    workflowRuleValidation.blockingIssues,
  ]);

  return (
    <div className="grid gap-5">
      <Tabs defaultValue="process" className="space-y-4" data-testid="playbook-authoring-tabs">
        <div className="sticky top-4 z-10 -mx-1 rounded-2xl bg-background/95 px-1 py-1 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <TabsList className="grid h-auto w-full gap-2 rounded-xl bg-border/20 p-2 sm:grid-cols-2">
            <TabsTrigger
              value="process"
              className="h-auto min-h-11 w-full justify-start px-4 py-3 text-left"
            >
              <span className="font-medium">Process</span>
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
            showValidationErrors={props.showValidationErrors}
            onChange={updateDraft}
            availableRoleNames={availableRoleNames}
          />
          <LaunchInputsSection
            draft={props.draft}
            showValidationErrors={props.showValidationErrors}
            onChange={updateDraft}
          />
          <WorkflowStagesSection
            draft={props.draft}
            showValidationErrors={props.showValidationErrors}
            onChange={updateDraft}
          />
        </TabsContent>

        <TabsContent value="advanced" className="space-y-4">
          <AdvancedWorkflowSection
            draft={props.draft}
            showValidationErrors={props.showValidationErrors}
            onChange={updateDraft}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
