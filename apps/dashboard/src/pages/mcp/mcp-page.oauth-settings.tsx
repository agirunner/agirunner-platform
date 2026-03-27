import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import type { RemoteMcpOauthFormState } from './mcp-page.support.js';
import {
  SelectField,
} from './mcp-page.oauth-fields.js';
import { McpPageOauthAdvancedSettings } from './mcp-page.oauth-settings.advanced.js';

export function McpPageOauthSettings(props: {
  value: RemoteMcpOauthFormState;
  onChange(next: RemoteMcpOauthFormState): void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(shouldShowAdvancedByDefault(props.value));

  useEffect(() => {
    if (shouldShowAdvancedByDefault(props.value)) {
      setShowAdvanced(true);
    }
  }, [props.value]);

  const update = <K extends keyof RemoteMcpOauthFormState>(
    key: K,
    value: RemoteMcpOauthFormState[K],
  ) => props.onChange({ ...props.value, [key]: value });

  return (
    <section className="grid gap-4 rounded-lg border border-border/70 bg-surface px-5 py-5">
      <div>
        <p className="font-medium text-foreground">OAuth setup</p>
        <p className="text-sm text-muted">
          Use automatic discovery for standard remote MCP OAuth servers. Switch to a manual client only when the server requires explicit client credentials or endpoint overrides.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <SelectField
          label="Grant type"
          value={props.value.grantType}
          onValueChange={(value) => update('grantType', value as RemoteMcpOauthFormState['grantType'])}
          items={[
            ['authorization_code', 'Authorization code'],
            ['device_authorization', 'Device authorization'],
            ['client_credentials', 'Client credentials'],
            ['enterprise_managed_authorization', 'Enterprise managed authorization'],
          ]}
        />
        <SelectField
          label="Setup mode"
          value={props.value.clientStrategy}
          onValueChange={(value) => update('clientStrategy', value as RemoteMcpOauthFormState['clientStrategy'])}
          items={[
            ['auto', 'Automatic discovery'],
            ['dynamic_registration', 'Dynamic registration'],
            ['client_metadata_document', 'Client metadata document'],
            ['manual_client', 'Manual client'],
          ]}
        />
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
            <McpPageOauthAdvancedSettings value={props.value} onChange={props.onChange} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function shouldShowAdvancedByDefault(value: RemoteMcpOauthFormState): boolean {
  return value.clientStrategy === 'manual_client'
    || value.callbackMode !== 'loopback'
    || value.registrationEndpointOverride.trim().length > 0
    || value.protectedResourceMetadataUrlOverride.trim().length > 0
    || value.authorizationServerMetadataUrlOverride.trim().length > 0
    || value.scopesText.trim().length > 0
    || value.resourceIndicatorsText.trim().length > 0
    || value.audiencesText.trim().length > 0
    || value.enterpriseProfileText.trim().length > 0
    || value.parMode !== 'disabled'
    || value.jarMode !== 'disabled'
    || value.privateKeyPem.trim().length > 0
    || value.hasStoredPrivateKeyPem;
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
