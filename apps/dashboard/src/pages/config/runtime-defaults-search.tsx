import { AlertCircle, RotateCcw } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import {
  getWebSearchProviderDetails,
  listWebSearchProviderDetails,
  resolveWebSearchProvider,
  shouldShowWebSearchApiKey,
  summarizeWebSearchPosture,
} from './runtime-defaults-search.support.js';
import {
  PLATFORM_DEFAULT_SELECT_VALUE,
} from './runtime-defaults.schema.js';
import type { FieldDefinition, FormValues } from './runtime-defaults.types.js';

export function RuntimeDefaultsSearchSection({
  fields,
  values,
  errors,
  onChange,
}: {
  fields: FieldDefinition[];
  values: FormValues;
  errors: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  const providerField = requireField(fields, 'tools.web_search_provider');
  const endpointField = requireField(fields, 'tools.web_search_base_url');
  const apiKeyField = requireField(fields, 'tools.web_search_api_key_secret_ref');
  const provider = resolveWebSearchProvider(values);
  const providerDetails = getWebSearchProviderDetails(provider);
  const posture = summarizeWebSearchPosture(values);
  const showApiKey = shouldShowWebSearchApiKey(values);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-5">
        <SearchFieldBlock
          field={providerField}
          error={errors[providerField.key]}
          extraDescription={providerDetails.description}
        >
          <Select
            value={values[providerField.key] || PLATFORM_DEFAULT_SELECT_VALUE}
            onValueChange={(nextValue) =>
              onChange(
                providerField.key,
                nextValue === PLATFORM_DEFAULT_SELECT_VALUE ? '' : nextValue,
              )
            }
          >
            <SelectTrigger
              id={providerField.key}
              className="h-10"
              aria-invalid={Boolean(errors[providerField.key])}
              data-testid={`field-${providerField.key}`}
            >
              <SelectValue placeholder={providerField.placeholder} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={PLATFORM_DEFAULT_SELECT_VALUE}>Use platform default</SelectItem>
              {listWebSearchProviderDetails().map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SearchFieldBlock>

        <SearchFieldBlock
          field={endpointField}
          error={errors[endpointField.key]}
          extraDescription={`Override only when ${providerDetails.label} needs a non-default endpoint.`}
        >
          <div className="space-y-2">
            <Input
              id={endpointField.key}
              value={values[endpointField.key] ?? ''}
              onChange={(event) => onChange(endpointField.key, event.target.value)}
              placeholder={providerDetails.endpointPlaceholder}
              aria-invalid={Boolean(errors[endpointField.key])}
              className="h-10"
              data-testid={`field-${endpointField.key}`}
            />
            {values[endpointField.key]?.trim() ? (
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onChange(endpointField.key, '')}
                  data-testid="clear-web-search-endpoint"
                >
                  <RotateCcw className="h-4 w-4" />
                  Use provider default endpoint
                </Button>
              </div>
            ) : null}
          </div>
        </SearchFieldBlock>

        {showApiKey ? (
          <SearchFieldBlock
            field={apiKeyField}
            error={errors[apiKeyField.key]}
            extraDescription={
              providerDetails.requiresApiKey
                ? `${providerDetails.label} requires a secret: reference before the runtime can call it directly.`
                : `${providerDetails.label} does not use an API key. Clear the stale secret reference to fall back cleanly.`
            }
          >
            <div className="space-y-2">
              <Input
                id={apiKeyField.key}
                value={values[apiKeyField.key] ?? ''}
                onChange={(event) => onChange(apiKeyField.key, event.target.value)}
                placeholder={apiKeyField.placeholder}
                aria-invalid={Boolean(errors[apiKeyField.key])}
                className="h-10"
                data-testid={`field-${apiKeyField.key}`}
              />
              {values[apiKeyField.key]?.trim() ? (
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onChange(apiKeyField.key, '')}
                    data-testid="clear-web-search-api-key"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Clear secret reference
                  </Button>
                </div>
              ) : null}
            </div>
          </SearchFieldBlock>
        ) : null}
      </div>

      <aside className="space-y-3 rounded-xl border border-border/70 bg-muted/10 p-4">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            Search posture
          </p>
          <p className="text-lg font-semibold text-foreground">{posture.providerLabel}</p>
          <p className="text-sm leading-6 text-muted">{posture.providerDescription}</p>
        </div>
        <div className="space-y-2 text-sm leading-6 text-muted">
          <p>{posture.endpointStatus}</p>
          <p>{posture.apiKeyStatus}</p>
        </div>
      </aside>
    </div>
  );
}

function SearchFieldBlock({
  field,
  error,
  extraDescription,
  children,
}: {
  field: FieldDefinition;
  error?: string;
  extraDescription: string;
  children: JSX.Element;
}) {
  return (
    <div className="space-y-2 rounded-xl border border-border/70 bg-card/80 p-4">
      <div className="space-y-1">
        <label className="text-sm font-medium" htmlFor={field.key}>
          {field.label}
        </label>
        <p className="text-xs leading-5 text-muted">{field.description}</p>
        <p className="text-xs leading-5 text-muted">{extraDescription}</p>
      </div>
      {children}
      {error ? (
        <p className="flex items-start gap-2 text-xs leading-5 text-red-600">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

function requireField(fields: FieldDefinition[], key: string): FieldDefinition {
  const field = fields.find((entry) => entry.key === key);
  if (!field) {
    throw new Error(`Missing runtime defaults field: ${key}`);
  }
  return field;
}
