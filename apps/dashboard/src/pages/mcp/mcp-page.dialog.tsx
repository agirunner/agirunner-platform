import { Plus, Trash2 } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { Button } from '../../components/ui/button.js';
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
import type { DashboardRemoteMcpServerRecord } from '../../lib/api.js';
import type {
  RemoteMcpParameterFormState,
  RemoteMcpServerFormState,
} from './mcp-page.support.js';

export function McpPageDialog(props: {
  open: boolean;
  mode: 'create' | 'edit';
  form: RemoteMcpServerFormState;
  server?: DashboardRemoteMcpServerRecord | null;
  isPending: boolean;
  error: string | null;
  submitLabel: string;
  onFormChange(next: RemoteMcpServerFormState): void;
  onClose(): void;
  onSubmit(): void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-[84rem] flex-col overflow-hidden p-0">
        <DialogHeader className="border-b border-border/70 px-6 py-5">
          <DialogTitle>
            {props.mode === 'edit' ? `Edit Remote MCP Server: ${props.server?.name ?? ''}` : 'Create Remote MCP Server'}
          </DialogTitle>
          <DialogDescription>
            Register a remote MCP endpoint, define its auth-bearing connection parameters, and verify it before specialists can use it.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            props.onSubmit();
          }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
              <div className="space-y-5">
                <section className="grid gap-4 rounded-lg border border-border/70 bg-surface px-5 py-5">
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="grid gap-2 text-sm">
                      <span className="font-medium">Name</span>
                      <Input
                        value={props.form.name}
                        onChange={(event) =>
                          props.onFormChange({ ...props.form, name: event.target.value })
                        }
                      />
                    </label>
                    <label className="grid gap-2 text-sm">
                      <span className="font-medium">Authentication</span>
                      <Select
                        value={props.form.authMode}
                        onValueChange={(value) =>
                          props.onFormChange({
                            ...props.form,
                            authMode: value as RemoteMcpServerFormState['authMode'],
                            parameters: normalizeParametersForAuthMode(
                              props.form.parameters,
                              value as RemoteMcpServerFormState['authMode'],
                            ),
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select authentication mode" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No authentication</SelectItem>
                          <SelectItem value="parameterized">Parameterized</SelectItem>
                          <SelectItem value="oauth">OAuth</SelectItem>
                        </SelectContent>
                      </Select>
                    </label>
                  </div>
                  <label className="grid gap-2 text-sm">
                    <span className="font-medium">Endpoint URL</span>
                    <Input
                      value={props.form.endpointUrl}
                      onChange={(event) =>
                        props.onFormChange({ ...props.form, endpointUrl: event.target.value })
                      }
                      placeholder="https://mcp.example.test/server"
                    />
                  </label>
                  <label className="grid gap-2 text-sm md:max-w-[14rem]">
                    <span className="font-medium">Call timeout (seconds)</span>
                    <Input
                      inputMode="numeric"
                      value={props.form.callTimeoutSeconds}
                      onChange={(event) =>
                        props.onFormChange({
                          ...props.form,
                          callTimeoutSeconds: event.target.value,
                        })
                      }
                      placeholder="300"
                    />
                  </label>
                  <label className="grid gap-2 text-sm">
                    <span className="font-medium">Description</span>
                    <Textarea
                      value={props.form.description}
                      onChange={(event) =>
                        props.onFormChange({ ...props.form, description: event.target.value })
                      }
                      rows={4}
                    />
                  </label>
                </section>

                <section className="grid gap-4 rounded-lg border border-border/70 bg-surface px-5 py-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{buildParameterSectionTitle(props.form.authMode)}</p>
                      <p className="text-sm text-muted">{buildParameterSectionDescription(props.form.authMode)}</p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        props.onFormChange({
                          ...props.form,
                          parameters: [...props.form.parameters, createBlankParameter()],
                        })
                      }
                    >
                      <Plus className="h-4 w-4" />
                      Add parameter
                    </Button>
                  </div>

                  <div className="space-y-3">
                    {props.form.parameters.map((parameter, index) => (
                      <ParameterRow
                        key={parameter.id}
                        authMode={props.form.authMode}
                        parameter={parameter}
                        index={index}
                        onChange={(nextParameter) => {
                          const parameters = props.form.parameters.map((entry) =>
                            entry.id === parameter.id ? nextParameter : entry,
                          );
                          props.onFormChange({ ...props.form, parameters });
                        }}
                        onRemove={() => {
                          const nextParameters = props.form.parameters.filter(
                            (entry) => entry.id !== parameter.id,
                          );
                          props.onFormChange({
                            ...props.form,
                            parameters: nextParameters.length > 0 ? nextParameters : [createBlankParameter()],
                          });
                        }}
                      />
                    ))}
                  </div>
                </section>
              </div>

              <aside className="space-y-5">
                <section className="rounded-lg border border-border/70 bg-muted/10 px-5 py-5">
                  <p className="font-medium text-foreground">Grant posture</p>
                  <div className="mt-4 space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          Enabled by default for new specialists
                        </p>
                        <p className="text-xs text-muted">
                          New specialists start with this server selected.
                        </p>
                      </div>
                      <Switch
                        checked={props.form.enabledByDefaultForNewSpecialists}
                        onCheckedChange={(checked) =>
                          props.onFormChange({
                            ...props.form,
                            enabledByDefaultForNewSpecialists: checked,
                          })
                        }
                        aria-label="Enabled by default for new specialists"
                      />
                    </div>
                    {props.mode === 'create' ? (
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            Grant to all existing specialists
                          </p>
                          <p className="text-xs text-muted">
                            Apply this server to every active specialist immediately.
                          </p>
                        </div>
                        <Switch
                          checked={props.form.grantToAllExistingSpecialists}
                          onCheckedChange={(checked) =>
                            props.onFormChange({
                              ...props.form,
                              grantToAllExistingSpecialists: checked,
                            })
                          }
                          aria-label="Grant to all existing specialists"
                        />
                      </div>
                    ) : null}
                  </div>
                </section>

                <section className="rounded-lg border border-border/70 bg-muted/10 px-5 py-5">
                  <p className="font-medium text-foreground">Authentication summary</p>
                  <p className="mt-2 text-sm text-muted">
                    {buildAuthSummary(props.form.authMode)}
                  </p>
                  <p className="mt-3 text-xs text-muted">
                    Tool calls from this server time out after {props.form.callTimeoutSeconds.trim() || '300'} seconds.
                  </p>
                  {props.server?.auth_mode === 'oauth' ? (
                    <p className="mt-3 text-xs text-muted">
                      {props.server.oauth_connected
                        ? props.server.oauth_needs_reauth
                          ? 'OAuth credentials are stored but must be reconnected before the server can be claimed.'
                          : 'OAuth credentials are connected for this server.'
                        : 'OAuth credentials are not connected for this server yet.'}
                    </p>
                  ) : null}
                </section>
              </aside>
            </div>
          </div>

          <div className="border-t border-border/70 bg-surface/95 px-6 py-4 backdrop-blur">
            {props.error ? (
              <p className="mb-3 text-sm text-red-600 dark:text-red-400">{props.error}</p>
            ) : null}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted">
                {props.form.authMode === 'oauth'
                  ? 'OAuth-backed servers authorize in a separate browser window and save only after the callback verifies successfully.'
                  : 'Saving verifies the remote server before specialists can use it.'}
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" onClick={props.onClose}>
                  Cancel
                </Button>
                <Button type="submit" disabled={props.isPending}>
                  {props.submitLabel}
                </Button>
              </div>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ParameterRow(props: {
  authMode: RemoteMcpServerFormState['authMode'];
  parameter: RemoteMcpParameterFormState;
  index: number;
  onChange(nextParameter: RemoteMcpParameterFormState): void;
  onRemove(): void;
}) {
  const allowSecretValues = props.authMode !== 'none';
  return (
    <div className="rounded-lg border border-border/70 bg-muted/10 px-4 py-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_minmax(0,11rem)_minmax(0,1.35fr)_auto]">
        <label className="grid gap-2 text-sm">
          <span className="font-medium">Parameter placement</span>
          <Select
            value={props.parameter.placement}
            onValueChange={(value) =>
              props.onChange({
                ...props.parameter,
                placement: value as RemoteMcpParameterFormState['placement'],
              })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Placement" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="path">Path</SelectItem>
              <SelectItem value="query">Query</SelectItem>
              <SelectItem value="header">Header</SelectItem>
              <SelectItem value="initialize_param">Initialize parameter</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="grid gap-2 text-sm">
          <span className="font-medium">Key</span>
          <Input
            value={props.parameter.key}
            onChange={(event) =>
              props.onChange({ ...props.parameter, key: event.target.value })
            }
            placeholder={`parameter-${props.index + 1}`}
          />
        </label>
        <label className="grid gap-2 text-sm">
          <span className="font-medium">Value type</span>
          <Select
            value={props.parameter.valueKind}
            onValueChange={(value) =>
              props.onChange({
                ...props.parameter,
                valueKind: value as RemoteMcpParameterFormState['valueKind'],
                value: '',
                hasStoredSecret:
                  props.parameter.valueKind === 'secret'
                  && value === 'secret'
                  && props.parameter.hasStoredSecret,
              })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Value type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="static">Static value</SelectItem>
              {allowSecretValues ? <SelectItem value="secret">Secret value</SelectItem> : null}
            </SelectContent>
          </Select>
        </label>
        <label className="grid gap-2 text-sm">
          <span className="font-medium">Value</span>
          <Input
            value={props.parameter.value}
            onChange={(event) =>
              props.onChange({ ...props.parameter, value: event.target.value })
            }
            placeholder={
              props.parameter.valueKind === 'secret'
                ? props.parameter.hasStoredSecret
                  ? 'Leave blank to preserve the stored secret'
                  : 'Enter secret value'
                : 'Enter static value'
            }
          />
        </label>
        <div className="flex items-end">
          <Button type="button" variant="outline" onClick={props.onRemove}>
            <Trash2 className="h-4 w-4" />
            Remove
          </Button>
        </div>
      </div>
    </div>
  );
}

function buildAuthSummary(authMode: RemoteMcpServerFormState['authMode']): string {
  if (authMode === 'oauth') {
    return 'OAuth discovers authorization metadata, opens the provider authorization flow, and saves only after callback verification succeeds.';
  }
  if (authMode === 'parameterized') {
    return 'Parameterized mode uses structured path, query, header, and initialize parameters, including secret-backed values.';
  }
  return 'No-auth mode only uses the endpoint URL and any non-secret static parameters you add.';
}

function buildParameterSectionTitle(authMode: RemoteMcpServerFormState['authMode']): string {
  return authMode === 'oauth' ? 'Additional connection parameters' : 'Connection parameters';
}

function buildParameterSectionDescription(authMode: RemoteMcpServerFormState['authMode']): string {
  if (authMode === 'oauth') {
    return 'OAuth provides authorization automatically. Use structured path, query, header, or initialize parameters only for additional non-OAuth connection data.';
  }
  if (authMode === 'none') {
    return 'Use structured path, query, header, or initialize parameters for static non-auth connection data.';
  }
  return 'Use structured path, query, header, or initialize parameters for connection data, including secret-backed values when needed.';
}

function normalizeParametersForAuthMode(
  parameters: RemoteMcpParameterFormState[],
  authMode: RemoteMcpServerFormState['authMode'],
): RemoteMcpParameterFormState[] {
  if (authMode !== 'none') {
    return parameters;
  }
  return parameters.map((parameter) => ({
    ...parameter,
    valueKind: 'static',
    value: parameter.valueKind === 'secret' ? '' : parameter.value,
    hasStoredSecret: false,
  }));
}

function createBlankParameter(): RemoteMcpParameterFormState {
  return {
    id: crypto.randomUUID(),
    placement: 'query',
    key: '',
    valueKind: 'static',
    value: '',
    hasStoredSecret: false,
  };
}
