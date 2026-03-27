import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import type { RemoteMcpOauthFormState } from './mcp-page.support.js';
import {
  SecretField,
  SelectField,
  TextField,
} from './mcp-page.oauth-fields.js';
import { McpPageOauthAdvancedSettings } from './mcp-page.oauth-settings.advanced.js';

export function McpPageOauthSettings(props: {
  value: RemoteMcpOauthFormState;
  onChange(next: RemoteMcpOauthFormState): void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(hasAdvancedConfiguration(props.value));

  useEffect(() => {
    if (hasAdvancedConfiguration(props.value)) {
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

      {showsManualClientFields(props.value) ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <TextField
            label="Client ID"
            value={props.value.clientId}
            onChange={(value) => update('clientId', value)}
            placeholder="client-id"
          />
          <SecretField
            label="Client secret"
            value={props.value.clientSecret}
            hasStoredSecret={props.value.hasStoredClientSecret}
            onChange={(value) => update('clientSecret', value)}
          />
          <SelectField
            label="Token auth method"
            value={props.value.tokenEndpointAuthMethod}
            onValueChange={(value) =>
              update('tokenEndpointAuthMethod', value as RemoteMcpOauthFormState['tokenEndpointAuthMethod'])
            }
            items={[
              ['none', 'None'],
              ['client_secret_post', 'Client secret POST'],
              ['client_secret_basic', 'Client secret basic'],
              ['private_key_jwt', 'Private key JWT'],
            ]}
          />
          {requiresAuthorizationEndpoint(props.value) ? (
            <TextField
              label="Authorization endpoint"
              value={props.value.authorizationEndpointOverride}
              onChange={(value) => update('authorizationEndpointOverride', value)}
              placeholder="https://auth.example.test/oauth/authorize"
            />
          ) : null}
          <TextField
            label="Token endpoint"
            value={props.value.tokenEndpointOverride}
            onChange={(value) => update('tokenEndpointOverride', value)}
            placeholder="https://auth.example.test/oauth/token"
          />
          {props.value.grantType === 'device_authorization' ? (
            <TextField
              label="Device authorization endpoint"
              value={props.value.deviceAuthorizationEndpointOverride}
              onChange={(value) => update('deviceAuthorizationEndpointOverride', value)}
              placeholder="https://auth.example.test/oauth/device"
            />
          ) : null}
        </div>
      ) : null}

      <div className="flex justify-start">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowAdvanced((current) => !current)}
        >
          {showAdvanced ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          Advanced OAuth settings
        </Button>
      </div>

      {showAdvanced ? (
        <McpPageOauthAdvancedSettings value={props.value} onChange={props.onChange} />
      ) : null}
    </section>
  );
}

function showsManualClientFields(value: RemoteMcpOauthFormState): boolean {
  return value.clientStrategy === 'manual_client';
}

function requiresAuthorizationEndpoint(value: RemoteMcpOauthFormState): boolean {
  return value.grantType === 'authorization_code'
    || value.grantType === 'enterprise_managed_authorization';
}

function hasAdvancedConfiguration(value: RemoteMcpOauthFormState): boolean {
  return value.callbackMode !== 'loopback'
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
    return 'Manual client setup requires the OAuth client and endpoint values supplied by the remote authorization server operator.';
  }
  if (value.clientStrategy === 'dynamic_registration') {
    return 'Dynamic registration uses the discovered registration endpoint to create a client before the browser flow starts.';
  }
  if (value.clientStrategy === 'client_metadata_document') {
    return 'Client metadata document mode uses the platform-published MCP client metadata document as the client identity.';
  }
  return 'Automatic discovery uses the MCP endpoint metadata. If the server does not advertise usable endpoints or client registration, switch to Manual client and enter the OAuth client and endpoint fields.';
}
