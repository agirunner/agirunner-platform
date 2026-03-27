import type { ReactNode } from 'react';

import { Button } from '../../components/ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Textarea } from '../../components/ui/textarea.js';
import type { RemoteMcpOAuthClientProfileFormState } from './mcp-page.oauth-client-profile-form.js';

export function McpPageOAuthClientProfileDialog(props: {
  open: boolean;
  mode: 'create' | 'edit';
  form: RemoteMcpOAuthClientProfileFormState;
  isPending: boolean;
  error: string | null;
  onOpenChange(open: boolean): void;
  onFormChange(next: RemoteMcpOAuthClientProfileFormState): void;
  onSubmit(): void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-[84rem] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {props.mode === 'edit' ? 'Edit OAuth Client Profile' : 'Create OAuth Client Profile'}
          </DialogTitle>
          <DialogDescription>
            Define reusable host-managed OAuth client credentials and endpoint defaults for remote
            MCP servers that cannot rely on automatic discovery alone.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            props.onSubmit();
          }}
        >
          <section className="grid gap-4 rounded-lg border border-border/70 bg-surface px-5 py-5">
            <div className="grid gap-4 xl:grid-cols-4">
              <LabeledField label="Name" className="xl:col-span-2">
                <Input
                  value={props.form.name}
                  onChange={(event) => updateField(props, 'name', event.target.value)}
                />
              </LabeledField>
              <LabeledField label="Callback mode">
                <Select
                  value={props.form.callbackMode}
                  onValueChange={(value) =>
                    updateField(
                      props,
                      'callbackMode',
                      value as RemoteMcpOAuthClientProfileFormState['callbackMode'],
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="loopback">Loopback callback</SelectItem>
                    <SelectItem value="hosted_https">Hosted HTTPS callback</SelectItem>
                  </SelectContent>
                </Select>
              </LabeledField>
              <LabeledField label="Token auth method">
                <Select
                  value={props.form.tokenEndpointAuthMethod}
                  onValueChange={(value) =>
                    updateField(
                      props,
                      'tokenEndpointAuthMethod',
                      value as RemoteMcpOAuthClientProfileFormState['tokenEndpointAuthMethod'],
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No client auth</SelectItem>
                    <SelectItem value="client_secret_post">Client secret POST</SelectItem>
                    <SelectItem value="client_secret_basic">Client secret basic</SelectItem>
                    <SelectItem value="private_key_jwt">Private key JWT</SelectItem>
                  </SelectContent>
                </Select>
              </LabeledField>
              <LabeledField label="Client ID" className="xl:col-span-2">
                <Input
                  value={props.form.clientId}
                  onChange={(event) => updateField(props, 'clientId', event.target.value)}
                />
              </LabeledField>
              <LabeledField label="Client secret" className="xl:col-span-2">
                <Input
                  type="password"
                  value={props.form.clientSecret}
                  placeholder={
                    props.form.hasStoredClientSecret
                      ? 'Leave blank to preserve the stored secret'
                      : 'Enter client secret'
                  }
                  onChange={(event) =>
                    props.onFormChange({
                      ...props.form,
                      clientSecret: event.target.value,
                      hasStoredClientSecret:
                        props.form.hasStoredClientSecret && event.target.value.trim().length === 0,
                    })
                  }
                />
              </LabeledField>
              <LabeledField label="Description" className="xl:col-span-4">
                <Textarea
                  rows={3}
                  value={props.form.description}
                  onChange={(event) => updateField(props, 'description', event.target.value)}
                />
              </LabeledField>
            </div>
          </section>

          <section className="grid gap-4 rounded-lg border border-border/70 bg-surface px-5 py-5">
            <div>
              <p className="font-medium text-foreground">OAuth endpoints</p>
              <p className="text-sm text-muted">
                These values become reusable defaults for MCP servers linked to this profile.
              </p>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <LabeledField label="Issuer">
                <Input
                  value={props.form.issuer}
                  onChange={(event) => updateField(props, 'issuer', event.target.value)}
                  placeholder="https://issuer.example.test"
                />
              </LabeledField>
              <LabeledField label="Authorization endpoint">
                <Input
                  value={props.form.authorizationEndpoint}
                  onChange={(event) =>
                    updateField(props, 'authorizationEndpoint', event.target.value)
                  }
                  placeholder="https://issuer.example.test/authorize"
                />
              </LabeledField>
              <LabeledField label="Token endpoint">
                <Input
                  value={props.form.tokenEndpoint}
                  onChange={(event) => updateField(props, 'tokenEndpoint', event.target.value)}
                  placeholder="https://issuer.example.test/token"
                />
              </LabeledField>
              <LabeledField label="Registration endpoint">
                <Input
                  value={props.form.registrationEndpoint}
                  onChange={(event) =>
                    updateField(props, 'registrationEndpoint', event.target.value)
                  }
                  placeholder="https://issuer.example.test/register"
                />
              </LabeledField>
              <LabeledField label="Device authorization endpoint" className="lg:col-span-2">
                <Input
                  value={props.form.deviceAuthorizationEndpoint}
                  onChange={(event) =>
                    updateField(props, 'deviceAuthorizationEndpoint', event.target.value)
                  }
                  placeholder="https://issuer.example.test/device"
                />
              </LabeledField>
            </div>
          </section>

          <section className="grid gap-4 rounded-lg border border-border/70 bg-surface px-5 py-5">
            <div>
              <p className="font-medium text-foreground">Default request values</p>
              <p className="text-sm text-muted">
                Use one value per line. Linked MCP servers inherit these defaults unless they
                provide explicit overrides.
              </p>
            </div>
            <div className="grid gap-4 xl:grid-cols-3">
              <LabeledField label="Default scopes">
                <Textarea
                  rows={6}
                  value={props.form.defaultScopesText}
                  onChange={(event) => updateField(props, 'defaultScopesText', event.target.value)}
                  placeholder="read:docs"
                />
              </LabeledField>
              <LabeledField label="Default resource indicators">
                <Textarea
                  rows={6}
                  value={props.form.defaultResourceIndicatorsText}
                  onChange={(event) =>
                    updateField(props, 'defaultResourceIndicatorsText', event.target.value)
                  }
                  placeholder="https://api.example.test"
                />
              </LabeledField>
              <LabeledField label="Default audiences">
                <Textarea
                  rows={6}
                  value={props.form.defaultAudiencesText}
                  onChange={(event) =>
                    updateField(props, 'defaultAudiencesText', event.target.value)
                  }
                  placeholder="mcp.example.test"
                />
              </LabeledField>
            </div>
          </section>

          {props.error ? (
            <p className="text-sm text-red-600 dark:text-red-400">{props.error}</p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={props.isPending}>
              {props.mode === 'edit' ? 'Save Profile' : 'Create Profile'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LabeledField(props: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`grid gap-2 text-sm ${props.className ?? ''}`.trim()}>
      <span className="font-medium">{props.label}</span>
      {props.children}
    </label>
  );
}

function updateField<K extends keyof RemoteMcpOAuthClientProfileFormState>(
  props: {
    form: RemoteMcpOAuthClientProfileFormState;
    onFormChange(next: RemoteMcpOAuthClientProfileFormState): void;
  },
  key: K,
  value: RemoteMcpOAuthClientProfileFormState[K],
) {
  props.onFormChange({ ...props.form, [key]: value });
}
