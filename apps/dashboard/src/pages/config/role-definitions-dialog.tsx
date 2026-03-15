import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog.js';
import {
  summarizeRoleSetup,
  validateRoleDialog,
} from './role-definitions-dialog.support.js';
import {
  RoleBasicsSection,
  RoleModelPreferenceSection,
} from './role-definitions-dialog.basics.js';
import {
  RoleToolGrantsSection,
} from './role-definitions-dialog.catalog.js';
import {
  RoleDialogFooter,
  RoleReadinessCard,
} from './role-definitions-dialog.summary.js';
import {
  buildRoleModelOptions,
  createRoleForm,
  listAvailableTools,
  type LlmModelRecord,
  type LlmProviderRecord,
  type RoleDefinition,
  type RoleFormState,
} from './role-definitions-page.support.js';

export function RoleDialog(props: {
  role?: RoleDefinition | null;
  duplicateFrom?: RoleDefinition | null;
  roles: RoleDefinition[];
  providers: LlmProviderRecord[];
  models: LlmModelRecord[];
  isModelCatalogLoading: boolean;
  modelCatalogError?: string | null;
  onSave(roleId: string | null, form: RoleFormState): Promise<unknown>;
  onClose(): void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<RoleFormState>(() => {
    if (props.role) return createRoleForm(props.role);
    if (props.duplicateFrom) {
      const duplicated = createRoleForm(props.duplicateFrom);
      duplicated.name = '';
      return duplicated;
    }
    return createRoleForm(null);
  });
  const mutation = useMutation({
    mutationFn: () => props.onSave(props.role?.id ?? null, form),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['roles'] });
      props.onClose();
    },
  });

  const tools = listAvailableTools(props.role);
  const modelOptions = buildRoleModelOptions(props.models, props.providers, props.role);
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

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="top-[5vh] flex max-h-[90vh] max-w-6xl translate-y-0 flex-col overflow-hidden p-0">
        <DialogHeader className="border-b border-border/70 px-6 py-5">
          <DialogTitle>{props.role ? `Edit Role: ${props.role.name}` : 'Create Role'}</DialogTitle>
          <DialogDescription>
            Configure specialist identity, model posture, tools, and escalation.
            Save blockers appear inline before submit.
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
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-5">
                <RoleBasicsSection
                  form={form}
                  setForm={setForm}
                  role={props.role}
                  validation={validation}
                />
                <RoleModelPreferenceSection
                  form={form}
                  setForm={setForm}
                  modelOptions={modelOptions}
                  isModelCatalogLoading={props.isModelCatalogLoading}
                  modelCatalogError={props.modelCatalogError}
                  validation={validation}
                />
                <RoleToolGrantsSection
                  form={form}
                  tools={tools}
                  toggleTool={toggleTool}
                />
              </div>

              <div className="space-y-5 xl:sticky xl:top-0">
                <RoleReadinessCard validation={validation} summary={summary} />
              </div>
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
