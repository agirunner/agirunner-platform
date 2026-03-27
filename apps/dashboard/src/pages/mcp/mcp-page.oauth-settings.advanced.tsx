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
}) {
  const update = <K extends keyof RemoteMcpOauthFormState>(
    key: K,
    value: RemoteMcpOauthFormState[K],
  ) => props.onChange({ ...props.value, [key]: value });

  return (
    <div className="grid gap-4 rounded-lg border border-border/70 bg-muted/10 p-4">
      <div>
        <p className="font-medium text-foreground">Advanced OAuth settings</p>
        <p className="text-sm text-muted">
          Use these fields only when the server requires non-default callback handling,
          metadata overrides, or advanced request contracts.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <SelectField
          label="Callback mode"
          value={props.value.callbackMode}
          onValueChange={(value) => update('callbackMode', value as RemoteMcpOauthFormState['callbackMode'])}
          items={[
            ['loopback', 'Loopback'],
            ['hosted_https', 'Hosted HTTPS'],
          ]}
        />
        <div className="grid gap-4 md:grid-cols-2">
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
          <div className="md:col-span-2">
            <SecretField
              label="Private key PEM"
              value={props.value.privateKeyPem}
              hasStoredSecret={props.value.hasStoredPrivateKeyPem}
              onChange={(value) => update('privateKeyPem', value)}
              multiline
            />
          </div>
        </div>
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
        <TextField
          label="Device authorization endpoint override"
          value={props.value.deviceAuthorizationEndpointOverride}
          onChange={(value) => update('deviceAuthorizationEndpointOverride', value)}
          placeholder="https://auth.example.test/oauth/device"
        />
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

      {props.value.grantType === 'enterprise_managed_authorization' ? (
        <TextareaField
          label="Enterprise authorization profile"
          value={props.value.enterpriseProfileText}
          onChange={(value) => update('enterpriseProfileText', value)}
          description="JSON object for enterprise-managed authorization broker settings."
          placeholder={'{\n  "issuer": "https://enterprise.example.test"\n}'}
        />
      ) : null}
    </div>
  );
}
