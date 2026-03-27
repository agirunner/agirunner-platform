import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Textarea } from '../../components/ui/textarea.js';
import type { RemoteMcpOauthFormState } from './mcp-page.support.js';

export function McpPageOauthSettings(props: {
  value: RemoteMcpOauthFormState;
  onChange(next: RemoteMcpOauthFormState): void;
}) {
  const update = <K extends keyof RemoteMcpOauthFormState>(
    key: K,
    value: RemoteMcpOauthFormState[K],
  ) => props.onChange({ ...props.value, [key]: value });

  return (
    <section className="grid gap-4 rounded-lg border border-border/70 bg-surface px-5 py-5">
      <div>
        <p className="font-medium text-foreground">OAuth settings</p>
        <p className="text-sm text-muted">
          Configure the remote MCP OAuth strategy, client posture, callback mode, and any provider-specific overrides.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
          label="Client strategy"
          value={props.value.clientStrategy}
          onValueChange={(value) => update('clientStrategy', value as RemoteMcpOauthFormState['clientStrategy'])}
          items={[
            ['auto', 'Automatic'],
            ['dynamic_registration', 'Dynamic registration'],
            ['client_metadata_document', 'Client metadata document'],
            ['manual_client', 'Manual client'],
          ]}
        />
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
        <TextField
          label="Client ID"
          value={props.value.clientId}
          onChange={(value) => update('clientId', value)}
          placeholder="github-client-id"
        />
        <SecretField
          label="Client secret"
          value={props.value.clientSecret}
          hasStoredSecret={props.value.hasStoredClientSecret}
          onChange={(value) => update('clientSecret', value)}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          label="Authorization endpoint override"
          value={props.value.authorizationEndpointOverride}
          onChange={(value) => update('authorizationEndpointOverride', value)}
          placeholder="https://auth.example.test/oauth/authorize"
        />
        <TextField
          label="Token endpoint override"
          value={props.value.tokenEndpointOverride}
          onChange={(value) => update('tokenEndpointOverride', value)}
          placeholder="https://auth.example.test/oauth/token"
        />
        <TextField
          label="Registration endpoint override"
          value={props.value.registrationEndpointOverride}
          onChange={(value) => update('registrationEndpointOverride', value)}
          placeholder="https://auth.example.test/oauth/register"
        />
        <TextField
          label="Device authorization endpoint override"
          value={props.value.deviceAuthorizationEndpointOverride}
          onChange={(value) => update('deviceAuthorizationEndpointOverride', value)}
          placeholder="https://auth.example.test/oauth/device"
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
          placeholder="https://api.githubcopilot.com/mcp/"
        />
        <TextareaField
          label="Audiences"
          value={props.value.audiencesText}
          onChange={(value) => update('audiencesText', value)}
          description="One audience per line or comma-separated."
          placeholder="https://github.com"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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
        <SecretField
          label="Private key PEM"
          value={props.value.privateKeyPem}
          hasStoredSecret={props.value.hasStoredPrivateKeyPem}
          onChange={(value) => update('privateKeyPem', value)}
          multiline
        />
      </div>

      <TextareaField
        label="Enterprise authorization profile"
        value={props.value.enterpriseProfileText}
        onChange={(value) => update('enterpriseProfileText', value)}
        description="JSON object for enterprise-managed authorization broker settings."
        placeholder={'{\n  "issuer": "https://enterprise.example.test"\n}'}
      />
    </section>
  );
}

function SelectField(props: {
  label: string;
  value: string;
  items: Array<[string, string]>;
  onValueChange(value: string): void;
}) {
  return (
    <label className="grid gap-2 text-sm">
      <span className="font-medium">{props.label}</span>
      <Select value={props.value} onValueChange={props.onValueChange}>
        <SelectTrigger>
          <SelectValue placeholder={props.label} />
        </SelectTrigger>
        <SelectContent>
          {props.items.map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function TextField(props: {
  label: string;
  value: string;
  placeholder?: string;
  onChange(value: string): void;
}) {
  return (
    <label className="grid gap-2 text-sm">
      <span className="font-medium">{props.label}</span>
      <Input value={props.value} placeholder={props.placeholder} onChange={(event) => props.onChange(event.target.value)} />
    </label>
  );
}

function TextareaField(props: {
  label: string;
  value: string;
  description: string;
  placeholder?: string;
  onChange(value: string): void;
}) {
  return (
    <label className="grid gap-2 text-sm">
      <span className="font-medium">{props.label}</span>
      <Textarea value={props.value} rows={4} placeholder={props.placeholder} onChange={(event) => props.onChange(event.target.value)} />
      <span className="text-xs text-muted">{props.description}</span>
    </label>
  );
}

function SecretField(props: {
  label: string;
  value: string;
  hasStoredSecret: boolean;
  multiline?: boolean;
  onChange(value: string): void;
}) {
  const placeholder = props.hasStoredSecret
    ? 'Leave blank to preserve the stored secret'
    : 'Enter secret value';
  return (
    <label className="grid gap-2 text-sm">
      <span className="font-medium">{props.label}</span>
      {props.multiline ? (
        <Textarea value={props.value} rows={4} placeholder={placeholder} onChange={(event) => props.onChange(event.target.value)} />
      ) : (
        <Input value={props.value} placeholder={placeholder} onChange={(event) => props.onChange(event.target.value)} />
      )}
    </label>
  );
}
