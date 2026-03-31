import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog.js';
import { DEFAULT_FORM_VALIDATION_MESSAGE } from '../../../components/forms/form-feedback.js';
import { summarizeRoleSetup, validateRoleDialog } from './role-definitions-dialog.support.js';
import {
  RoleBasicsSection,
  RoleExecutionEnvironmentSection,
  RoleModelAssignmentSection,
} from './role-definitions-dialog.basics.js';
import { RoleRemoteMcpSection } from './role-definitions-dialog.mcp.js';
import { RoleToolGrantsSection } from './role-definitions-dialog.catalog.js';
import { RoleSkillsSection } from './role-definitions-dialog.skills.js';
import { RoleDialogFooter, RoleReadinessCard } from './role-definitions-dialog.summary.js';
import {
  buildRoleExecutionEnvironmentOptions,
  createRoleForm,
  listDefaultRoleMcpServerIds,
  listAvailableTools,
  resolveEffectiveRoleModel,
  syncNativeSearchGrant,
  type LlmModelRecord,
  type LlmProviderRecord,
  type RoleDefinition,
  type RoleExecutionEnvironmentSummary,
  type RoleFormState,
  type RoleToolCatalogEntry,
} from './role-definitions-page.support.js';
import type {
  RoleAssignmentRecord,
  SystemDefaultRecord,
} from './role-definitions-orchestrator.support.js';
import type {
  DashboardRemoteMcpServerRecord,
  DashboardSpecialistSkillRecord,
} from '../../../lib/api.js';
import { updateAssignment } from './role-definitions-page.api.js';

export function RoleDialog(props: {
  role?: RoleDefinition | null;
  duplicateFrom?: RoleDefinition | null;
  roles: RoleDefinition[];
  providers: LlmProviderRecord[];
  models: LlmModelRecord[];
  tools: RoleToolCatalogEntry[];
  executionEnvironments: RoleExecutionEnvironmentSummary[];
  remoteMcpServers: DashboardRemoteMcpServerRecord[];
  specialistSkills: DashboardSpecialistSkillRecord[];
  systemDefault?: SystemDefaultRecord;
  assignments: RoleAssignmentRecord[];
  isModelCatalogLoading: boolean;
  modelCatalogError?: string | null;
  onSave(roleId: string | null, form: RoleFormState): Promise<unknown>;
  onClose(): void;
}) {
  const queryClient = useQueryClient();
  const sourceRole = props.role ?? props.duplicateFrom ?? null;
  const roleName = props.role?.name ?? '';
  const currentAssignment = props.assignments.find(
    (a) => a.role_name.trim().toLowerCase() === roleName.trim().toLowerCase(),
  );
  const initialSelectedModelId = currentAssignment?.primary_model_id?.trim() ?? '';
  const initialEffectiveModel = resolveEffectiveRoleModel(
    props.models,
    initialSelectedModelId,
    props.systemDefault?.modelId,
  );
  const defaultRemoteMcpServerIds = listDefaultRoleMcpServerIds(props.remoteMcpServers);

  const [form, setForm] = useState<RoleFormState>(() => {
    const defaultToolIds = listAvailableTools(props.tools, null, initialEffectiveModel).map(
      (tool) => tool.id,
    );
    if (props.role) {
      return {
        ...createRoleForm(props.role, defaultToolIds),
        allowedTools: listAvailableTools(props.tools, props.role, initialEffectiveModel).map(
          (tool) => tool.id,
        ),
      };
    }
    if (props.duplicateFrom) {
      const duplicated = syncNativeSearchGrant(
        {
          ...createRoleForm(props.duplicateFrom, defaultToolIds),
          allowedTools: listAvailableTools(
            props.tools,
            props.duplicateFrom,
            initialEffectiveModel,
          ).map((tool) => tool.id),
        },
        initialEffectiveModel,
        { enableByDefault: true },
      );
      duplicated.name = '';
      return duplicated;
    }
    return syncNativeSearchGrant(
      createRoleForm(null, defaultToolIds, defaultRemoteMcpServerIds),
      initialEffectiveModel,
      {
        enableByDefault: true,
      },
    );
  });

  const [selectedModelId, setSelectedModelId] = useState<string>(initialSelectedModelId);
  const [reasoningConfig, setReasoningConfig] = useState<Record<string, unknown> | null>(
    currentAssignment?.reasoning_config ?? null,
  );
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      await props.onSave(props.role?.id ?? null, form);
      const savedName = form.name.trim();
      if (savedName) {
        const currentModelId = currentAssignment?.primary_model_id?.trim() ?? '';
        const modelChanged = selectedModelId !== currentModelId;
        const reasoningChanged =
          JSON.stringify(reasoningConfig) !==
          JSON.stringify(currentAssignment?.reasoning_config ?? null);
        if (modelChanged || reasoningChanged) {
          await updateAssignment(savedName, {
            primaryModelId: selectedModelId || undefined,
            reasoningConfig,
          });
        }
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['roles'] });
      void queryClient.invalidateQueries({ queryKey: ['llm-assignments'] });
      props.onClose();
    },
  });

  const effectiveModel = resolveEffectiveRoleModel(
    props.models,
    selectedModelId,
    props.systemDefault?.modelId,
  );
  const executionEnvironmentOptions = buildRoleExecutionEnvironmentOptions(
    props.executionEnvironments,
    form.executionEnvironmentId,
    sourceRole?.execution_environment ?? null,
  );
  const selectedEnvironment =
    executionEnvironmentOptions.find(
      (environment) => environment.id === form.executionEnvironmentId,
    ) ??
    sourceRole?.execution_environment ??
    null;
  const tools = listAvailableTools(props.tools, sourceRole, effectiveModel);
  const validation = validateRoleDialog(form, props.roles, props.role);
  const summary = summarizeRoleSetup(form, selectedEnvironment);

  useEffect(() => {
    setForm((current) =>
      syncNativeSearchGrant(current, effectiveModel, {
        enableByDefault: !props.role,
      }),
    );
  }, [effectiveModel?.id, props.role]);

  function toggleTool(value: string) {
    setForm((current) => ({
      ...current,
      allowedTools: current.allowedTools.includes(value)
        ? current.allowedTools.filter((item) => item !== value)
        : [...current.allowedTools, value],
    }));
  }

  const selectedModel = props.models.find((m) => m.id === selectedModelId);

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="top-[5vh] flex max-h-[90vh] max-w-[68rem] translate-y-0 flex-col overflow-hidden p-0">
        <DialogHeader className="border-b border-border/70 px-6 py-5">
          <DialogTitle>
            {props.role ? `Edit Specialist: ${props.role.name}` : 'Create Specialist'}
          </DialogTitle>
          <DialogDescription>
            Define the specialist identity, prompt, model, and tools.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (!validation.isValid) {
              setHasAttemptedSubmit(true);
              return;
            }
            mutation.mutate();
          }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="space-y-5">
              <RoleBasicsSection
                form={form}
                setForm={setForm}
                role={props.role}
                validation={validation}
                showValidationErrors={hasAttemptedSubmit}
              />
              <RoleModelAssignmentSection
                models={props.models}
                providers={props.providers}
                selectedModelId={selectedModelId}
                reasoningConfig={reasoningConfig}
                selectedModel={selectedModel}
                isLoading={props.isModelCatalogLoading}
                error={props.modelCatalogError}
                onModelChange={(nextModelId) => {
                  setSelectedModelId(nextModelId);
                  const nextModel = resolveEffectiveRoleModel(
                    props.models,
                    nextModelId,
                    props.systemDefault?.modelId,
                  );
                  setForm((current) =>
                    syncNativeSearchGrant(current, nextModel, {
                      enableByDefault: true,
                    }),
                  );
                }}
                onReasoningChange={setReasoningConfig}
              />
              <RoleToolGrantsSection form={form} tools={tools} toggleTool={toggleTool} />
              <RoleRemoteMcpSection
                form={form}
                setForm={(next) => setForm(next)}
                role={sourceRole}
                servers={props.remoteMcpServers}
              />
              <RoleSkillsSection
                form={form}
                setForm={(next) => setForm(next)}
                role={sourceRole}
                skills={props.specialistSkills}
              />
              <RoleExecutionEnvironmentSection
                form={form}
                setForm={setForm}
                environments={executionEnvironmentOptions}
              />
              <RoleReadinessCard summary={summary} />
            </div>
          </div>
          <RoleDialogFooter
            mutationError={mutation.error}
            validation={validation}
            showValidationErrors={hasAttemptedSubmit}
            isPending={mutation.isPending}
            submitLabel={props.role ? 'Save Specialist' : 'Create Specialist'}
            validationMessage={DEFAULT_FORM_VALIDATION_MESSAGE}
            onClose={props.onClose}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
