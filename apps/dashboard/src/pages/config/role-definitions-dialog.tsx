import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog.js';
import {
  summarizeRoleSetup,
  validateRoleDialog,
} from './role-definitions-dialog.support.js';
import {
  RoleBasicsSection,
  RoleModelAssignmentSection,
} from './role-definitions-dialog.basics.js';
import {
  RoleToolGrantsSection,
} from './role-definitions-dialog.catalog.js';
import {
  RoleDialogFooter,
  RoleReadinessCard,
} from './role-definitions-dialog.summary.js';
import {
  createRoleForm,
  listAvailableTools,
  type LlmModelRecord,
  type LlmProviderRecord,
  type RoleDefinition,
  type RoleFormState,
} from './role-definitions-page.support.js';
import type { RoleAssignmentRecord } from './role-definitions-orchestrator.support.js';
import { updateAssignment } from './role-definitions-page.api.js';

export function RoleDialog(props: {
  role?: RoleDefinition | null;
  duplicateFrom?: RoleDefinition | null;
  roles: RoleDefinition[];
  providers: LlmProviderRecord[];
  models: LlmModelRecord[];
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

  const [form, setForm] = useState<RoleFormState>(() => {
    if (props.role) return createRoleForm(props.role);
    if (props.duplicateFrom) {
      const duplicated = createRoleForm(props.duplicateFrom);
      duplicated.name = '';
      return duplicated;
    }
    return createRoleForm(null);
  });

  const [selectedModelId, setSelectedModelId] = useState<string>(
    currentAssignment?.primary_model_id?.trim() ?? '',
  );
  const [reasoningConfig, setReasoningConfig] = useState<Record<string, unknown> | null>(
    currentAssignment?.reasoning_config ?? null,
  );

  const mutation = useMutation({
    mutationFn: async () => {
      await props.onSave(props.role?.id ?? null, form);
      const savedName = form.name.trim();
      if (savedName) {
        const currentModelId = currentAssignment?.primary_model_id?.trim() ?? '';
        const modelChanged = selectedModelId !== currentModelId;
        const reasoningChanged = JSON.stringify(reasoningConfig) !== JSON.stringify(currentAssignment?.reasoning_config ?? null);
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

  const tools = listAvailableTools(sourceRole);
  const validation = validateRoleDialog(form, props.roles, props.role);
  const summary = summarizeRoleSetup(form);

  function toggleTool(value: string) {
    setForm((current) => ({
      ...current,
      allowedTools: current.allowedTools.includes(value)
        ? current.allowedTools.filter((item) => item !== value)
        : [...current.allowedTools, value],
    }));
  }

  const selectedModel = props.models.find((m) => m.model_id === selectedModelId);

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="top-[5vh] flex max-h-[90vh] max-w-4xl translate-y-0 flex-col overflow-hidden p-0">
        <DialogHeader className="border-b border-border/70 px-6 py-5">
          <DialogTitle>{props.role ? `Edit Role: ${props.role.name}` : 'Create Role'}</DialogTitle>
          <DialogDescription>
            Define the specialist identity, prompt, model, and tools.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (!validation.isValid) {
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
              />
              <RoleModelAssignmentSection
                models={props.models}
                providers={props.providers}
                selectedModelId={selectedModelId}
                reasoningConfig={reasoningConfig}
                selectedModel={selectedModel}
                isLoading={props.isModelCatalogLoading}
                error={props.modelCatalogError}
                onModelChange={setSelectedModelId}
                onReasoningChange={setReasoningConfig}
              />
              <RoleToolGrantsSection
                form={form}
                tools={tools}
                toggleTool={toggleTool}
              />
              <RoleReadinessCard validation={validation} summary={summary} />
            </div>
          </div>
          <RoleDialogFooter
            mutationError={mutation.error}
            validation={validation}
            isPending={mutation.isPending}
            submitLabel={props.role ? 'Save Role' : 'Create Role'}
            onClose={props.onClose}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
