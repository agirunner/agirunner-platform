import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import type { DashboardRemoteMcpOAuthClientProfileRecord } from '../../lib/api.js';
import type { RemoteMcpOauthFormState } from './mcp-page.support.js';
import { McpPageOauthAdvancedSettings } from './mcp-page.oauth-settings.advanced.js';

export function McpPageOauthSettings(props: {
  value: RemoteMcpOauthFormState;
  oauthClientProfileId: string;
  oauthClientProfiles: DashboardRemoteMcpOAuthClientProfileRecord[];
  onOauthClientProfileIdChange(next: string): void;
  onChange(next: RemoteMcpOauthFormState): void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const selectedOauthClientProfile =
    props.oauthClientProfiles.find((profile) => profile.id === props.oauthClientProfileId) ?? null;

  return (
    <section className="grid gap-4 rounded-lg border border-border/70 bg-surface px-5 py-5">
      <div>
        <p className="font-medium text-foreground">OAuth setup</p>
        <p className="text-sm text-muted">
          Use automatic discovery for standard remote MCP OAuth servers. Select a shared OAuth
          client profile only when the server needs host-managed client credentials or endpoint
          defaults.
        </p>
      </div>

      <label className="grid gap-2 text-sm">
        <span className="font-medium">OAuth client profile</span>
        <Select
          value={props.oauthClientProfileId || '__none__'}
          onValueChange={(value) =>
            props.onOauthClientProfileIdChange(value === '__none__' ? '' : value)
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Use automatic discovery only" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Use automatic discovery only</SelectItem>
            {props.oauthClientProfiles.map((profile) => (
              <SelectItem key={profile.id} value={profile.id}>
                {profile.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted">
          {selectedOauthClientProfile
            ? `Using ${selectedOauthClientProfile.name} for reusable client credentials and endpoint defaults.`
            : props.oauthClientProfiles.length > 0
              ? 'Leave this blank unless the remote server requires a host-managed OAuth client profile.'
              : 'No shared OAuth client profiles exist yet. Use automatic discovery here, or create a profile below on the MCP Servers page if this provider requires one.'}
        </span>
      </label>

      <div className="rounded-lg border border-border/70 bg-muted/10 px-4 py-3 text-sm text-muted">
        {readOauthSetupDescription(props.value, selectedOauthClientProfile?.name ?? null)}
      </div>

      <div className="rounded-lg border border-border/70 bg-muted/10">
        <Button
          type="button"
          variant="ghost"
          className="flex h-auto w-full items-start justify-between rounded-lg px-4 py-4 text-left"
          onClick={() => setShowAdvanced((current) => !current)}
        >
          <div className="space-y-1">
            <p className="font-medium text-foreground">Advanced OAuth settings</p>
            <p className="text-sm text-muted">
              Open this section for manual client details, callback handling, request contract overrides, and advanced OAuth metadata.
            </p>
          </div>
          {showAdvanced ? <ChevronDown className="mt-0.5 h-4 w-4" /> : <ChevronRight className="mt-0.5 h-4 w-4" />}
        </Button>

        {showAdvanced ? (
          <div className="border-t border-border/70 px-4 py-4">
            <McpPageOauthAdvancedSettings
              value={props.value}
              onChange={props.onChange}
              onManualClientSelected={() => setShowAdvanced(true)}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function readOauthSetupDescription(
  value: RemoteMcpOauthFormState,
  oauthClientProfileName: string | null,
): string {
  if (oauthClientProfileName) {
    return `Shared OAuth client profile ${oauthClientProfileName} will supply reusable client credentials and endpoint defaults. Leave Advanced OAuth settings collapsed unless this server needs extra request overrides or a different grant posture.`;
  }
  if (value.clientStrategy === 'manual_client') {
    return 'Manual client setup requires the OAuth client and endpoint values supplied by the remote authorization server operator. Those fields live under Advanced OAuth settings.';
  }
  if (value.clientStrategy === 'dynamic_registration') {
    return 'Dynamic registration uses the discovered registration endpoint to create a client before the browser flow starts.';
  }
  if (value.clientStrategy === 'client_metadata_document') {
    return 'Client metadata document mode uses the platform-published MCP client metadata document as the client identity.';
  }
  return 'Automatic discovery uses the MCP endpoint metadata. If the server does not advertise usable endpoints or client registration, switch to Manual client and enter the OAuth client and endpoint fields.';
}
