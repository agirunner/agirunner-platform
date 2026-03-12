import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Switch } from '../../components/ui/switch.js';
import { Textarea } from '../../components/ui/textarea.js';
import { cn } from '../../lib/utils.js';
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
  const otherRoles = props.roles.filter((role) => role.id !== props.role?.id);
  const capabilities = listAvailableCapabilities(props.role);
  const tools = listAvailableTools(props.role);
  const modelOptions = buildRoleModelOptions(props.models, props.providers, props.role);

  function toggleListValue(field: 'allowedTools' | 'capabilities', value: string) {
    setForm((current) => ({
      ...current,
      [field]: current[field].includes(value)
        ? current[field].filter((item) => item !== value)
        : [...current[field], value],
    }));
  }

  function addListValue(field: 'allowedTools' | 'capabilities', value: string, clear: () => void) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setForm((current) => ({
      ...current,
      [field]: current[field].includes(trimmed) ? current[field] : [...current[field], trimmed],
    }));
    clear();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="max-h-[85vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{props.role ? `Edit Role: ${props.role.name}` : 'Create Role'}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <Card>
            <CardHeader>
              <CardTitle>Role basics</CardTitle>
              <CardDescription>Set the role identity, prompt, lifecycle state, and review posture.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-2 text-sm">
                <span className="font-medium">Name</span>
                <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required />
              </label>
              <div className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/10 px-4 py-3">
                <div>
                  <div className="font-medium">Active role</div>
                  <p className="text-sm text-muted">Inactive roles stay visible but are excluded from active use.</p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant={props.role?.is_built_in ? 'secondary' : 'outline'}>
                    {props.role?.is_built_in ? 'Built-in' : 'Custom'}
                  </Badge>
                  <Switch checked={form.isActive} onCheckedChange={(checked) => setForm((current) => ({ ...current, isActive: checked }))} aria-label="Active role" />
                </div>
              </div>
              <label className="grid gap-2 text-sm md:col-span-2">
                <span className="font-medium">Description</span>
                <Input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="What this role is responsible for." />
              </label>
              <label className="grid gap-2 text-sm md:col-span-2">
                <span className="font-medium">System prompt</span>
                <Textarea value={form.systemPrompt} onChange={(event) => setForm((current) => ({ ...current, systemPrompt: event.target.value }))} rows={8} />
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium">Verification strategy</span>
                <Select value={form.verificationStrategy} onValueChange={(value) => setForm((current) => ({ ...current, verificationStrategy: value }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="peer_review">Peer review</SelectItem>
                    <SelectItem value="human_approval">Human approval</SelectItem>
                    <SelectItem value="automated_test">Automated test</SelectItem>
                    <SelectItem value="unit_tests">Unit tests</SelectItem>
                    <SelectItem value="structured_review">Structured review</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium">Escalation target</span>
                <Select value={form.escalationTarget ?? '__none__'} onValueChange={(value) => setForm((current) => ({ ...current, escalationTarget: value === '__none__' ? null : value }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    <SelectItem value="human">Human</SelectItem>
                    {otherRoles.map((role) => <SelectItem key={role.id} value={role.name}>{role.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </label>
              {form.escalationTarget ? (
                <label className="grid gap-2 text-sm">
                  <span className="font-medium">Max escalation depth</span>
                  <Input type="number" min={1} max={10} value={form.maxEscalationDepth} onChange={(event) => setForm((current) => ({ ...current, maxEscalationDepth: Math.max(1, Math.min(10, Number(event.target.value) || 1)) }))} />
                </label>
              ) : null}
            </CardContent>
          </Card>

          <div className="grid gap-5 xl:grid-cols-[1.1fr_1.4fr]">
            <Card>
              <CardHeader>
                <CardTitle>Model preference</CardTitle>
                <CardDescription>Choose live models for the role default and fallback chain.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <label className="grid gap-2 text-sm">
                  <span className="font-medium">Preferred model</span>
                  <Select value={form.modelPreference || '__system__'} onValueChange={(value) => setForm((current) => ({ ...current, modelPreference: value === '__system__' ? '' : value, fallbackModel: value === '__system__' ? '' : current.fallbackModel }))}>
                    <SelectTrigger><SelectValue placeholder={props.isModelCatalogLoading ? 'Loading models...' : 'Use system default'} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__system__">Use system default</SelectItem>
                      {modelOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="font-medium">Fallback model</span>
                  <Select disabled={!form.modelPreference} value={form.fallbackModel || '__none__'} onValueChange={(value) => setForm((current) => ({ ...current, fallbackModel: value === '__none__' ? '' : value }))}>
                    <SelectTrigger><SelectValue placeholder={form.modelPreference ? 'Select fallback model' : 'Choose a preferred model first'} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No fallback</SelectItem>
                      {modelOptions.filter((option) => option.value !== form.modelPreference).map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </label>
                <div className="rounded-lg border border-border/70 bg-muted/10 px-4 py-3 text-sm text-muted">
                  {props.modelCatalogError
                    ? `Model catalog unavailable: ${props.modelCatalogError}. Existing selections remain editable.`
                    : 'Live models come from the enabled provider catalog. Workflow and project overrides can still supersede this default.'}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Capabilities</CardTitle>
                <CardDescription>Advertise what the role can do for routing, staffing, and operator understanding.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  {capabilities.map((capability) => (
                    <button
                      key={capability.value}
                      type="button"
                      onClick={() => toggleListValue('capabilities', capability.value)}
                      className={cn(
                        'rounded-lg border px-3 py-3 text-left transition-colors',
                        form.capabilities.includes(capability.value)
                          ? 'border-accent bg-accent/10'
                          : 'border-border/70 bg-muted/10 hover:bg-muted/20',
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium">{capability.label}</div>
                        <Badge variant={form.capabilities.includes(capability.value) ? 'default' : 'outline'}>{capability.category}</Badge>
                      </div>
                      <div className="mt-1 text-sm text-muted">{capability.description}</div>
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {form.capabilities.map((capability) => <Badge key={capability} variant="secondary">{capability}</Badge>)}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input value={customCapability} onChange={(event) => setCustomCapability(event.target.value)} placeholder="Add a custom capability, for example role:data-scientist" />
                  <Button type="button" variant="outline" onClick={() => addListValue('capabilities', customCapability, () => setCustomCapability(''))}>Add custom capability</Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Tool grants</CardTitle>
              <CardDescription>Grant concrete tools directly instead of forcing raw JSON edits.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted">Existing grants that are no longer in the standard catalog still stay editable here.</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {tools.map((tool) => (
                  <label key={tool} className="flex items-center gap-2 rounded-md border border-border/70 bg-muted/10 px-3 py-2 text-sm">
                    <input type="checkbox" checked={form.allowedTools.includes(tool)} onChange={() => toggleListValue('allowedTools', tool)} className="rounded" />
                    <span>{tool}</span>
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {form.allowedTools.map((tool) => <Badge key={tool} variant="outline">{tool}</Badge>)}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input value={customTool} onChange={(event) => setCustomTool(event.target.value)} placeholder="Add a custom tool grant" />
                <Button type="button" variant="outline" onClick={() => addListValue('allowedTools', customTool, () => setCustomTool(''))}>Add custom tool</Button>
              </div>
            </CardContent>
          </Card>

          {mutation.error ? <p className="text-sm text-red-600">{String(mutation.error)}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={props.onClose}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {props.role ? 'Save Role' : 'Create Role'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
