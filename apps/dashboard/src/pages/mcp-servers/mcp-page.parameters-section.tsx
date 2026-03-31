import { Plus, Trash2 } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import type {
  RemoteMcpParameterFormState,
  RemoteMcpServerFormState,
} from './mcp-page.support.js';

export function McpPageParametersSection(props: {
  authMode: RemoteMcpServerFormState['authMode'];
  parameters: RemoteMcpParameterFormState[];
  onAdd(): void;
  onChange(parameterId: string, nextParameter: RemoteMcpParameterFormState): void;
  onRemove(parameterId: string): void;
}) {
  const allowSecretValues = props.authMode !== 'none';
  const placementOptions = buildPlacementOptions(props.authMode);

  return (
    <section className="grid gap-4 rounded-lg border border-border/70 bg-surface px-5 py-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium text-foreground">{buildParameterSectionTitle(props.authMode)}</p>
          <p className="text-sm text-muted">{buildParameterSectionDescription(props.authMode)}</p>
        </div>
        <Button type="button" variant="outline" onClick={props.onAdd}>
          <Plus className="h-4 w-4" />
          Add parameter
        </Button>
      </div>

      <div className="space-y-3">
        {props.parameters.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/70 bg-muted/5 px-4 py-4 text-sm text-muted">
            {buildEmptyStateMessage(props.authMode)}
          </div>
        ) : null}
        {props.parameters.map((parameter, index) => (
          <div
            key={parameter.id}
            className="rounded-lg border border-border/70 bg-muted/10 px-4 py-4"
          >
            <div className="grid gap-4 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_minmax(0,12rem)_minmax(0,1.35fr)_auto]">
              <label className="grid gap-2 text-sm">
                <span className="font-medium">Parameter placement</span>
                <Select
                  value={parameter.placement}
                  onValueChange={(value) =>
                    props.onChange(parameter.id, {
                      ...parameter,
                      placement: value as RemoteMcpParameterFormState['placement'],
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Placement" />
                  </SelectTrigger>
                  <SelectContent>
                    {placementOptions.map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium">Key</span>
                <Input
                  value={parameter.key}
                  onChange={(event) =>
                    props.onChange(parameter.id, { ...parameter, key: event.target.value })
                  }
                  placeholder={`parameter-${index + 1}`}
                />
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium">Value type</span>
                <Select
                  value={parameter.valueKind}
                  onValueChange={(value) =>
                    props.onChange(parameter.id, {
                      ...parameter,
                      valueKind: value as RemoteMcpParameterFormState['valueKind'],
                      value: '',
                      hasStoredSecret:
                        parameter.valueKind === 'secret'
                        && value === 'secret'
                        && parameter.hasStoredSecret,
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
                  value={parameter.value}
                  onChange={(event) =>
                    props.onChange(parameter.id, { ...parameter, value: event.target.value })
                  }
                  placeholder={buildValuePlaceholder(parameter)}
                />
              </label>
              <div className="flex items-end">
                <Button type="button" variant="outline" onClick={() => props.onRemove(parameter.id)}>
                  <Trash2 className="h-4 w-4" />
                  Remove
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function buildPlacementOptions(
  authMode: RemoteMcpServerFormState['authMode'],
): Array<[RemoteMcpParameterFormState['placement'], string]> {
  const common: Array<[RemoteMcpParameterFormState['placement'], string]> = [
    ['path', 'Path'],
    ['query', 'Query'],
    ['header', 'Header'],
    ['cookie', 'Cookie'],
    ['initialize_param', 'Initialize parameter'],
  ];
  if (authMode !== 'oauth') {
    return common;
  }
  return [
    ...common,
    ['authorize_request_query', 'Authorize request query'],
    ['device_request_query', 'Device request query'],
    ['device_request_header', 'Device request header'],
    ['device_request_body_form', 'Device request body (form)'],
    ['device_request_body_json', 'Device request body (JSON)'],
    ['token_request_query', 'Token request query'],
    ['token_request_header', 'Token request header'],
    ['token_request_body_form', 'Token request body (form)'],
    ['token_request_body_json', 'Token request body (JSON)'],
  ];
}

function buildParameterSectionTitle(authMode: RemoteMcpServerFormState['authMode']): string {
  return authMode === 'oauth' ? 'Additional connection parameters' : 'Connection parameters';
}

function buildParameterSectionDescription(authMode: RemoteMcpServerFormState['authMode']): string {
  if (authMode === 'oauth') {
    return 'OAuth provides authorization automatically. Use these parameters for path templating, cookies, and additional authorize, device, or token request values.';
  }
  if (authMode === 'none') {
    return 'Use path, query, header, cookie, or initialize parameters for static non-auth connection data.';
  }
  return 'Use structured path, query, header, cookie, or initialize parameters for connection data, including secret-backed values when needed.';
}

function buildValuePlaceholder(parameter: RemoteMcpParameterFormState): string {
  if (parameter.valueKind !== 'secret') {
    return 'Enter static value';
  }
  return parameter.hasStoredSecret
    ? 'Leave blank to preserve the stored secret'
    : 'Enter secret value';
}

function buildEmptyStateMessage(authMode: RemoteMcpServerFormState['authMode']): string {
  if (authMode === 'oauth') {
    return 'No additional connection parameters are configured. Add one only if the remote MCP server requires path templating, cookies, or extra authorize, device, or token request values.';
  }
  if (authMode === 'none') {
    return 'No connection parameters are configured. Add one only if this server requires static path, query, header, cookie, or initialize values.';
  }
  return 'No connection parameters are configured. Add one only if this server requires structured path, query, header, cookie, or initialize values.';
}
