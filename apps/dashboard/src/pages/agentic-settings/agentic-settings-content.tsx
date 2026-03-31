import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import { dashboardApi, type DashboardAgenticSettingsRecord } from '../../lib/api.js';
import { ConfigInputField, ConfigSelectField } from './config-form-controls.js';
import {
  FIELD_DEFINITIONS,
  PRIMARY_RUNTIME_DEFAULT_SECTION_KEYS,
  RUNTIME_INLINE_SECTION_COLUMNS,
  SECTION_DEFINITIONS,
} from './runtime-defaults.schema.js';
import { RuntimeDefaultsEditor } from './runtime-defaults-editor.js';
import {
  AGENTIC_PROMPT_WARNING_THRESHOLD_DEFAULT,
  validatePromptWarningThresholdChars,
} from './runtime-defaults-page.support.js';

const AGENTIC_SETTINGS_QUERY_KEY = ['agentic-settings'];

const LIVE_VISIBILITY_OPTIONS = [
  { value: 'standard', label: 'Standard' },
  { value: 'enhanced', label: 'Enhanced' },
] as const;

export function AgenticSettingsContent(): JSX.Element {
  const queryClient = useQueryClient();
  const liveVisibilityQuery = useQuery({
    queryKey: AGENTIC_SETTINGS_QUERY_KEY,
    queryFn: () => dashboardApi.getAgenticSettings(),
  });
  const [liveVisibilityMode, setLiveVisibilityMode] =
    useState<DashboardAgenticSettingsRecord['live_visibility_mode_default']>('enhanced');
  const [promptWarningThresholdChars, setPromptWarningThresholdChars] = useState(
    String(AGENTIC_PROMPT_WARNING_THRESHOLD_DEFAULT),
  );

  useEffect(() => {
    const nextMode = liveVisibilityQuery.data?.live_visibility_mode_default;
    const nextPromptWarningThreshold = liveVisibilityQuery.data?.prompt_warning_threshold_chars;
    if (!nextMode) {
      return;
    }
    setLiveVisibilityMode(nextMode);
    if (typeof nextPromptWarningThreshold === 'number') {
      setPromptWarningThresholdChars(String(nextPromptWarningThreshold));
    }
  }, [
    liveVisibilityQuery.data?.live_visibility_mode_default,
    liveVisibilityQuery.data?.prompt_warning_threshold_chars,
    liveVisibilityQuery.data?.revision,
  ]);

  if (liveVisibilityQuery.isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (liveVisibilityQuery.error) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          Failed to load agentic settings: {String(liveVisibilityQuery.error)}
        </div>
      </div>
    );
  }

  const liveVisibilitySettings = liveVisibilityQuery.data;
  if (!liveVisibilitySettings) {
    return <></>;
  }

  const hasLiveVisibilityChanges =
    liveVisibilityMode !== liveVisibilitySettings.live_visibility_mode_default;
  const hasPromptWarningThresholdChanges =
    promptWarningThresholdChars !==
    String(liveVisibilitySettings.prompt_warning_threshold_chars);
  const promptWarningThresholdError =
    validatePromptWarningThresholdChars(promptWarningThresholdChars);

  return (
    <RuntimeDefaultsEditor
      navHref="/admin/agentic-settings"
      description="Configure defaults for specialist agent runtime behavior, safeguards, and execution posture. Specialist execution environments are managed on Platform > Environments."
      headerDescriptionClassName="max-w-none whitespace-nowrap"
      fieldDefinitions={FIELD_DEFINITIONS}
      sectionDefinitions={SECTION_DEFINITIONS}
      primarySectionKeys={PRIMARY_RUNTIME_DEFAULT_SECTION_KEYS}
      inlineSectionColumns={RUNTIME_INLINE_SECTION_COLUMNS}
      sectionIdPrefix="runtime-defaults"
      successMessage="Agentic Settings saved."
      errorLabel="agentic settings"
      additionalHasValidationErrors={Boolean(promptWarningThresholdError)}
      sectionSupplementalContent={{
        connected_platform: (
          <div className="grid gap-4 md:grid-cols-2">
            <ConfigSelectField
              fieldId="agentic-live-visibility-mode"
              label="Live visibility mode"
              description="Default operator visibility for workflows that do not set their own override."
              support="Standard keeps the streamlined workflow view. Enhanced enables the richer live activity view."
              value={liveVisibilityMode}
              options={LIVE_VISIBILITY_OPTIONS}
              onValueChange={(value) =>
                setLiveVisibilityMode(
                  value as DashboardAgenticSettingsRecord['live_visibility_mode_default'],
                )
              }
            />
            <ConfigInputField
              fieldId="agentic-prompt-warning-threshold"
              label="Prompt warning threshold"
              description="Character budget where assembled prompts start receiving pressure warnings."
              support="Applies the tenant default when a workflow does not carry its own override."
              error={promptWarningThresholdError ?? undefined}
              inputProps={{
                type: 'number',
                inputMode: 'numeric',
                min: 1,
                step: 1,
                value: promptWarningThresholdChars,
                onChange: (event) => setPromptWarningThresholdChars(event.target.value),
              }}
            />
          </div>
        ),
      }}
      additionalHasChanges={hasLiveVisibilityChanges || hasPromptWarningThresholdChanges}
      onResetAdditional={() => {
        setLiveVisibilityMode(liveVisibilitySettings.live_visibility_mode_default);
        setPromptWarningThresholdChars(
          String(liveVisibilitySettings.prompt_warning_threshold_chars),
        );
      }}
      onSaveAdditional={async () => {
        if (!hasLiveVisibilityChanges && !hasPromptWarningThresholdChanges) {
          return;
        }
        if (promptWarningThresholdError) {
          throw new Error(promptWarningThresholdError);
        }
        const updated = await dashboardApi.updateAgenticSettings({
          live_visibility_mode_default: liveVisibilityMode,
          prompt_warning_threshold_chars: Number(promptWarningThresholdChars.trim()),
          settings_revision: liveVisibilitySettings.revision,
        });
        queryClient.setQueryData(AGENTIC_SETTINGS_QUERY_KEY, updated);
        await queryClient.invalidateQueries({ queryKey: AGENTIC_SETTINGS_QUERY_KEY });
      }}
    />
  );
}
