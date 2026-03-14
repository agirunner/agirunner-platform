import { RotateCcw } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import {
  ConfigInputField,
  ConfigSelectField,
} from './config-form-controls.js';
import {
  buildWebSearchFieldSupport,
  buildWebSearchRecoveryGuidance,
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
  const recoveryGuidance = buildWebSearchRecoveryGuidance(values, errors);
  const fieldSupport = buildWebSearchFieldSupport(values, errors);
  const showApiKey = shouldShowWebSearchApiKey(values);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-5">
        <ConfigSelectField
          fieldId={providerField.key}
          label={providerField.label}
          value={values[providerField.key] || PLATFORM_DEFAULT_SELECT_VALUE}
          description={
            <>
              <span>{providerField.description}</span>{' '}
              <span>{providerDetails.description}</span>
            </>
          }
          support={fieldSupport.provider}
          error={errors[providerField.key]}
          className="rounded-xl border border-border/70 bg-card/80 p-4"
          placeholder={providerField.placeholder}
          options={[
            {
              value: PLATFORM_DEFAULT_SELECT_VALUE,
              label: 'Use platform default',
            },
            ...listWebSearchProviderDetails().map((option) => ({
              value: option.value,
              label: option.label,
            })),
          ]}
          onValueChange={(nextValue) =>
            onChange(
              providerField.key,
              nextValue === PLATFORM_DEFAULT_SELECT_VALUE ? '' : nextValue,
            )
          }
          triggerClassName="h-10"
          triggerTestId={`field-${providerField.key}`}
        />

        <ConfigInputField
          fieldId={endpointField.key}
          label={endpointField.label}
          description={
            <>
              <span>{endpointField.description}</span>{' '}
              <span>
                Override only when {providerDetails.label} needs a non-default endpoint.
              </span>
            </>
          }
          support={fieldSupport.endpoint}
          error={errors[endpointField.key]}
          className="rounded-xl border border-border/70 bg-card/80 p-4"
          inputTestId={`field-${endpointField.key}`}
          action={
            values[endpointField.key]?.trim() ? (
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
            ) : undefined
          }
          inputProps={{
            value: values[endpointField.key] ?? '',
            onChange: (event) => onChange(endpointField.key, event.target.value),
            placeholder: providerDetails.endpointPlaceholder,
            className: 'h-10',
          }}
        />

        {showApiKey ? (
          <ConfigInputField
            fieldId={apiKeyField.key}
            label={apiKeyField.label}
            description={
              providerDetails.requiresApiKey
                ? `${providerDetails.label} requires a secret: reference before the runtime can call it directly.`
                : `${providerDetails.label} does not use an API key. Clear the stale secret reference to fall back cleanly.`
            }
            support={fieldSupport.apiKey}
            error={errors[apiKeyField.key]}
            className="rounded-xl border border-border/70 bg-card/80 p-4"
            inputTestId={`field-${apiKeyField.key}`}
            action={
              values[apiKeyField.key]?.trim() ? (
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
              ) : undefined
            }
            inputProps={{
              value: values[apiKeyField.key] ?? '',
              onChange: (event) => onChange(apiKeyField.key, event.target.value),
              placeholder: apiKeyField.placeholder,
              className: 'h-10',
            }}
          />
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
        <div className="space-y-2 rounded-lg border border-border/70 bg-background/70 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            Recovery guidance
          </p>
          <ul className="space-y-2 text-sm leading-6 text-muted">
            {recoveryGuidance.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </aside>
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
