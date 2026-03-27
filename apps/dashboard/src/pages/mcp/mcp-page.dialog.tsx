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
import type {
  DashboardRemoteMcpOAuthClientProfileRecord,
  DashboardRemoteMcpServerRecord,
} from '../../lib/api.js';
import { McpPageOauthSettings } from './mcp-page.oauth-settings.js';
import { McpPageParametersSection } from './mcp-page.parameters-section.js';
import {
  createRemoteMcpParameterForm,
  formatRemoteMcpTransportPreference,
  normalizeParametersForAuthMode,
  type RemoteMcpServerFormState,
} from './mcp-page.support.js';

export function McpPageDialog(props: {
  open: boolean;
  mode: 'create' | 'edit';
  form: RemoteMcpServerFormState;
  server?: DashboardRemoteMcpServerRecord | null;
  oauthClientProfiles: DashboardRemoteMcpOAuthClientProfileRecord[];
  isPending: boolean;
  error: string | null;
  submitLabel: string;
  onFormChange(next: RemoteMcpServerFormState): void;
  onClose(): void;
  onSubmit(): void;
}) {
  const selectedOauthClientProfile =
    props.form.authMode === 'oauth'
      ? props.oauthClientProfiles.find((profile) => profile.id === props.form.oauthClientProfileId) ?? null
      : null;

  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="flex max-h-[92vh] max-w-[92rem] flex-col overflow-hidden p-0">
        <DialogHeader className="border-b border-border/70 px-6 py-5">
          <DialogTitle>
            {props.mode === 'edit' ? `Edit Remote MCP Server: ${props.server?.name ?? ''}` : 'Create Remote MCP Server'}
          </DialogTitle>
          <DialogDescription>
            Register a remote MCP server, define its transport and auth contract, and verify it before specialists can use it.
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
            <div className="space-y-5">
              <section className="grid gap-4 rounded-lg border border-border/70 bg-surface px-5 py-5">
                <div className="grid gap-4 xl:grid-cols-4">
                  <label className="grid gap-2 text-sm xl:col-span-2">
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
                  <label className="grid gap-2 text-sm">
                    <span className="font-medium">Transport preference</span>
                    <Select
                      value={props.form.transportPreference}
                      onValueChange={(value) =>
                        props.onFormChange({
                          ...props.form,
                          transportPreference: value as RemoteMcpServerFormState['transportPreference'],
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select transport preference" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Automatic negotiation</SelectItem>
                        <SelectItem value="streamable_http">Streamable HTTP only</SelectItem>
                        <SelectItem value="http_sse_compat">HTTP + SSE compatibility only</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="grid gap-2 text-sm xl:col-span-2">
                    <span className="font-medium">Endpoint URL</span>
                    <Input
                      value={props.form.endpointUrl}
                      onChange={(event) =>
                        props.onFormChange({ ...props.form, endpointUrl: event.target.value })
                      }
                      placeholder="https://mcp.example.test/server"
                    />
                  </label>
                  <label className="grid gap-2 text-sm xl:col-span-2">
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
                  <label className="grid gap-2 text-sm xl:col-span-4">
                    <span className="font-medium">Description</span>
                    <Textarea
                      value={props.form.description}
                      onChange={(event) =>
                        props.onFormChange({ ...props.form, description: event.target.value })
                      }
                      rows={4}
                    />
                  </label>
                </div>
              </section>

              <div className="grid gap-5 lg:grid-cols-2">
                <section className="rounded-lg border border-border/70 bg-muted/10 px-5 py-5">
                  <p className="font-medium text-foreground">Grant posture</p>
                  <div className="mt-4 space-y-4">
                    <ToggleRow
                      label="Enabled by default for new specialists"
                      description="New specialists start with this server selected."
                      checked={props.form.enabledByDefaultForNewSpecialists}
                      onCheckedChange={(checked) =>
                        props.onFormChange({
                          ...props.form,
                          enabledByDefaultForNewSpecialists: checked,
                        })
                      }
                    />
                    {props.mode === 'create' ? (
                      <ToggleRow
                        label="Grant to all existing specialists"
                        description="Apply this server to every active specialist immediately."
                        checked={props.form.grantToAllExistingSpecialists}
                        onCheckedChange={(checked) =>
                          props.onFormChange({
                            ...props.form,
                            grantToAllExistingSpecialists: checked,
                          })
                        }
                      />
                    ) : null}
                  </div>
                </section>

                <section className="rounded-lg border border-border/70 bg-muted/10 px-5 py-5">
                  <p className="font-medium text-foreground">Connection summary</p>
                  <div className="mt-3 space-y-2 text-sm text-muted">
                    <p>Transport preference: {formatRemoteMcpTransportPreference(props.form.transportPreference)}</p>
                    <p>{buildAuthSummary(props.form, selectedOauthClientProfile?.name ?? null)}</p>
                    <p>Tool calls from this server time out after {props.form.callTimeoutSeconds.trim() || '300'} seconds.</p>
                    {props.form.authMode === 'oauth' ? (
                      <p>
                        {props.server?.oauth_connected
                          ? props.server.oauth_needs_reauth
                            ? 'OAuth credentials are stored but must be reconnected before the server can be claimed.'
                            : 'OAuth credentials are connected for this server.'
                          : 'OAuth credentials are not connected for this server yet.'}
                      </p>
                    ) : null}
                  </div>
                </section>
              </div>

              {props.form.authMode === 'oauth' ? (
                <McpPageOauthSettings
                  value={props.form.oauth}
                  oauthClientProfileId={props.form.oauthClientProfileId}
                  oauthClientProfiles={props.oauthClientProfiles}
                  onOauthClientProfileIdChange={(oauthClientProfileId) =>
                    props.onFormChange({ ...props.form, oauthClientProfileId })
                  }
                  onChange={(oauth) => props.onFormChange({ ...props.form, oauth })}
                />
              ) : null}
              <McpPageParametersSection
                authMode={props.form.authMode}
                parameters={props.form.parameters}
                onAdd={() =>
                  props.onFormChange({
                    ...props.form,
                    parameters: [...props.form.parameters, createRemoteMcpParameterForm()],
                  })
                }
                onChange={(parameterId, nextParameter) =>
                  props.onFormChange({
                    ...props.form,
                    parameters: props.form.parameters.map((entry) =>
                      entry.id === parameterId ? nextParameter : entry,
                    ),
                  })
                }
                onRemove={(parameterId) =>
                  props.onFormChange({
                    ...props.form,
                    parameters: ensureParametersAfterRemoval(props.form.parameters, parameterId),
                  })
                }
              />
            </div>
          </div>
          <div className="border-t border-border/70 bg-surface/95 px-6 py-4 backdrop-blur">
            {props.error ? (
              <p className="mb-3 text-sm text-red-600 dark:text-red-400">{props.error}</p>
            ) : null}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted">
                {props.form.authMode === 'oauth'
                  ? 'OAuth-backed servers complete through the configured provider flow and save only after the verified connection contract is established.'
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
function ToggleRow(props: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange(checked: boolean): void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-sm font-medium text-foreground">{props.label}</p>
        <p className="text-xs text-muted">{props.description}</p>
      </div>
      <Switch checked={props.checked} onCheckedChange={props.onCheckedChange} aria-label={props.label} />
    </div>
  );
}

function ensureParametersAfterRemoval(
  parameters: RemoteMcpServerFormState['parameters'],
  parameterId: string,
): RemoteMcpServerFormState['parameters'] {
  return parameters.filter((entry) => entry.id !== parameterId);
}

function buildAuthSummary(
  form: RemoteMcpServerFormState,
  oauthClientProfileName: string | null,
): string {
  if (form.authMode === 'oauth') {
    if (oauthClientProfileName) {
      return `OAuth uses the shared client profile ${oauthClientProfileName}. Automatic discovery still applies unless you open Advanced OAuth settings for server-specific overrides.`;
    }
    return 'OAuth uses automatic discovery by default. Open Advanced OAuth settings only when the server needs a manual client contract or request overrides.';
  }
  if (form.authMode === 'parameterized') {
    return 'Parameterized mode uses structured path, query, header, cookie, and initialize parameters, including secret-backed values.';
  }
  return 'No-auth mode only uses the endpoint URL and any non-secret static parameters you add.';
}
