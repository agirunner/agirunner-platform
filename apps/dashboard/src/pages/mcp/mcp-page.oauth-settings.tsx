import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import type { RemoteMcpOauthFormState } from './mcp-page.support.js';
import { McpPageOauthAdvancedSettings } from './mcp-page.oauth-settings.advanced.js';

export function McpPageOauthSettings(props: {
  value: RemoteMcpOauthFormState;
  onChange(next: RemoteMcpOauthFormState): void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <section className="grid gap-4 rounded-lg border border-border/70 bg-surface px-5 py-5">
      <div>
        <p className="font-medium text-foreground">OAuth setup</p>
        <p className="text-sm text-muted">
          Use automatic discovery for standard remote MCP OAuth servers. Switch to a manual client only when the server requires explicit client credentials or endpoint overrides.
        </p>
      </div>

      <div className="rounded-lg border border-border/70 bg-muted/10 px-4 py-3 text-sm text-muted">
        {readOauthSetupDescription(props.value)}
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

function readOauthSetupDescription(value: RemoteMcpOauthFormState): string {
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
