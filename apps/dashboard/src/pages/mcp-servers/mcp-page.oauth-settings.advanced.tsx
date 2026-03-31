import type { RemoteMcpOauthFormState } from './mcp-page.support.js';
import {
  SecretField,
  SelectField,
  TextField,
  TextareaField,
} from './mcp-page.oauth-fields.js';

export function McpPageOauthAdvancedSettings(props: {
  value: RemoteMcpOauthFormState;
  onChange(next: RemoteMcpOauthFormState): void;
  onManualClientSelected(): void;
}) {
  const update = <K extends keyof RemoteMcpOauthFormState>(
    key: K,
    value: RemoteMcpOauthFormState[K],
  ) => props.onChange({ ...props.value, [key]: value });

  const updateClientStrategy = (value: RemoteMcpOauthFormState['clientStrategy']) => {
    update('clientStrategy', value);
    if (value === 'manual_client') {
      props.onManualClientSelected();
    }
  };

  return (
    <div className="grid gap-5">
      <div className="grid gap-4 md:grid-cols-2">
        <SelectField
          label="Grant type"
          value={props.value.grantType}
          onValueChange={(value) =>
            update('grantType', value as RemoteMcpOauthFormState['grantType'])
          }
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
          onValueChange={(value) =>
            updateClientStrategy(value as RemoteMcpOauthFormState['clientStrategy'])
          }
          items={[
            ['auto', 'Automatic discovery'],
            ['dynamic_registration', 'Dynamic registration'],
            ['client_metadata_document', 'Client metadata document'],
            ['manual_client', 'Manual client'],
          ]}
        />
      </div>

      {props.value.clientStrategy === 'manual_client' ? (
        <section className="grid gap-4">
          <div>
            <p className="font-medium text-foreground">Manual client details</p>
            <p className="text-sm text-muted">
              Supply the client credentials and endpoint contract provided by the remote authorization server operator.
            </p>
          </div>
          <div className="grid gap-4 xl:grid-cols-3">
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
          </div>
          <div className="grid gap-4 md:grid-cols-2">
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
        </section>
      ) : null}

      <section className="grid gap-4">
        <div className="grid gap-4 md:grid-cols-3">
          <SelectField
            label="Callback mode"
            value={props.value.callbackMode}
            onValueChange={(value) => update('callbackMode', value as RemoteMcpOauthFormState['callbackMode'])}
            items={[
              ['loopback', 'Loopback'],
              ['hosted_https', 'Hosted HTTPS'],
            ]}
          />
          <SelectField
            label="PAR mode"
            value={props.value.parMode}
            onValueChange={(value) => update('parMode', value as RemoteMcpOauthFormState['parMode'])}
            items={[
              ['disabled', 'Disabled'],
              ['enabled', 'Enabled'],
              ['required', 'Required'],
            ]}
          />
          <SelectField
            label="JAR mode"
            value={props.value.jarMode}
            onValueChange={(value) => update('jarMode', value as RemoteMcpOauthFormState['jarMode'])}
            items={[
              ['disabled', 'Disabled'],
              ['request_parameter', 'Request parameter'],
              ['request_uri', 'Request URI'],
            ]}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            label="Registration endpoint override"
            value={props.value.registrationEndpointOverride}
            onChange={(value) => update('registrationEndpointOverride', value)}
            placeholder="https://auth.example.test/oauth/register"
          />
          <TextField
            label="Protected resource metadata URL override"
            value={props.value.protectedResourceMetadataUrlOverride}
            onChange={(value) => update('protectedResourceMetadataUrlOverride', value)}
            placeholder="https://mcp.example.test/.well-known/oauth-protected-resource/server"
          />
          <TextField
            label="Authorization server metadata URL override"
            value={props.value.authorizationServerMetadataUrlOverride}
            onChange={(value) => update('authorizationServerMetadataUrlOverride', value)}
            placeholder="https://auth.example.test/.well-known/oauth-authorization-server"
          />
          {props.value.clientStrategy !== 'manual_client'
            && props.value.grantType === 'device_authorization' ? (
              <TextField
                label="Device authorization endpoint override"
                value={props.value.deviceAuthorizationEndpointOverride}
                onChange={(value) => update('deviceAuthorizationEndpointOverride', value)}
                placeholder="https://auth.example.test/oauth/device"
              />
            ) : null}
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          <TextareaField
            label="Scopes"
            value={props.value.scopesText}
            onChange={(value) => update('scopesText', value)}
            description="One scope per line or comma-separated."
            placeholder={'repo\nread:org'}
          />
          <TextareaField
            label="Resource indicators"
            value={props.value.resourceIndicatorsText}
            onChange={(value) => update('resourceIndicatorsText', value)}
            description="One resource per line or comma-separated."
            placeholder="https://mcp.example.test/server"
          />
          <TextareaField
            label="Audiences"
            value={props.value.audiencesText}
            onChange={(value) => update('audiencesText', value)}
            description="One audience per line or comma-separated."
            placeholder="https://auth.example.test"
          />
        </div>

        {showsPrivateKeyField(props.value) ? (
          <SecretField
            label="Private key PEM"
            value={props.value.privateKeyPem}
            hasStoredSecret={props.value.hasStoredPrivateKeyPem}
            onChange={(value) => update('privateKeyPem', value)}
            multiline
          />
        ) : null}

        {props.value.grantType === 'enterprise_managed_authorization' ? (
          <TextareaField
            label="Enterprise authorization profile"
            value={props.value.enterpriseProfileText}
            onChange={(value) => update('enterpriseProfileText', value)}
            description="JSON object for enterprise-managed authorization broker settings."
            placeholder={'{\n  "issuer": "https://enterprise.example.test"\n}'}
          />
        ) : null}
      </section>
    </div>
  );
}

function requiresAuthorizationEndpoint(value: RemoteMcpOauthFormState): boolean {
  return value.grantType === 'authorization_code'
    || value.grantType === 'enterprise_managed_authorization';
}

function showsPrivateKeyField(value: RemoteMcpOauthFormState): boolean {
  return value.tokenEndpointAuthMethod === 'private_key_jwt'
    || value.privateKeyPem.trim().length > 0
    || value.hasStoredPrivateKeyPem;
}
