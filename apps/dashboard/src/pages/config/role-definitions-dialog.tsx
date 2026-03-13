import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog.js';
import {
  buildEscalationTargetOptions,
  summarizeRoleSetup,
  validateRoleDialog,
} from './role-definitions-dialog.support.js';
import {
  RoleBasicsSection,
  RoleModelPreferenceSection,
} from './role-definitions-dialog.basics.js';
import {
  RoleCapabilitiesSection,
  RoleToolGrantsSection,
} from './role-definitions-dialog.catalog.js';
import {
  RoleDialogFooter,
  RoleReadinessCard,
} from './role-definitions-dialog.summary.js';
import {
  buildRoleModelOptions,
  createRoleForm,
  listAvailableCapabilities,
  listAvailableTools,
  type LlmModelRecord,
  type LlmProviderRecord,
  type RoleDefinition,
  type RoleFormState,
} from './role-definitions-page.support.js';

export function RoleDialog(props: {
  role?: RoleDefinition | null;
  roles: RoleDefinition[];
  providers: LlmProviderRecord[];
  models: LlmModelRecord[];
  isModelCatalogLoading: boolean;
  modelCatalogError?: string | null;
  onSave(roleId: string | null, form: RoleFormState): Promise<unknown>;
  onClose(): void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<RoleFormState>(createRoleForm(props.role));
  const [customCapability, setCustomCapability] = useState('');
  const [customTool, setCustomTool] = useState('');
  const mutation = useMutation({
    mutationFn: () => props.onSave(props.role?.id ?? null, form),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['roles'] });
      props.onClose();
    },
  });

  const capabilities = listAvailableCapabilities(props.role);
  const tools = listAvailableTools(props.role);
  const modelOptions = buildRoleModelOptions(props.models, props.providers, props.role);
  const escalationOptions = buildEscalationTargetOptions(props.roles, props.role);
  const validation = validateRoleDialog(form, props.roles, props.role);
  const summary = summarizeRoleSetup(form);

  function toggleListValue(field: 'allowedTools' | 'capabilities', value: string) {
    setForm((current) => ({
      ...current,
      [field]: current[field].includes(value)
        ? current[field].filter((item) => item !== value)
        : [...current[field], value],
    }));
  }

  function addListValue(
    field: 'allowedTools' | 'capabilities',
    value: string,
    reset: () => void,
  ) {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    setForm((current) => ({
      ...current,
      [field]: current[field].includes(trimmed) ? current[field] : [...current[field], trimmed],
    }));
    reset();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="max-h-[90vh] max-w-6xl overflow-hidden p-0">
        <DialogHeader className="border-b border-border/70 px-6 py-5">
          <DialogTitle>{props.role ? `Edit Role: ${props.role.name}` : 'Create Role'}</DialogTitle>
          <DialogDescription>
            Configure specialist routing, model posture, capabilities, and escalation in one
            operator workflow. Save blockers appear inline before submit.
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
                  escalationOptions={escalationOptions}
                  validation={validation}
                />
                <div className="grid gap-5 xl:grid-cols-[1.1fr_1.4fr]">
                  <RoleModelPreferenceSection
                    form={form}
                    setForm={setForm}
                    modelOptions={modelOptions}
                    isModelCatalogLoading={props.isModelCatalogLoading}
                    modelCatalogError={props.modelCatalogError}
                    validation={validation}
                  />
                  <RoleCapabilitiesSection
                    form={form}
                    capabilities={capabilities}
                    customCapability={customCapability}
                    setCustomCapability={setCustomCapability}
                    toggleCapability={(value) => toggleListValue('capabilities', value)}
                    addCustomCapability={() =>
                      addListValue('capabilities', customCapability, () => setCustomCapability(''))
                    }
                  />
                </div>
                <RoleToolGrantsSection
                  form={form}
                  tools={tools}
                  customTool={customTool}
                  setCustomTool={setCustomTool}
                  toggleTool={(value) => toggleListValue('allowedTools', value)}
                  addCustomTool={() =>
                    addListValue('allowedTools', customTool, () => setCustomTool(''))
                  }
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
