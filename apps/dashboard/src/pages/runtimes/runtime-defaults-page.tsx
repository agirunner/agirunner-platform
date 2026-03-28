import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import { dashboardApi, type DashboardAgenticSettingsRecord } from '../../lib/api.js';
import { ConfigSelectField } from './config-form-controls.js';
import {
  FIELD_DEFINITIONS,
  PRIMARY_RUNTIME_DEFAULT_SECTION_KEYS,
  RUNTIME_INLINE_SECTION_COLUMNS,
  SECTION_DEFINITIONS,
} from './runtime-defaults.schema.js';
import { RuntimeDefaultsEditorPage } from './runtime-defaults-editor-page.js';

const AGENTIC_SETTINGS_QUERY_KEY = ['agentic-settings'];

const LIVE_VISIBILITY_OPTIONS = [
  { value: 'standard', label: 'Standard' },
  { value: 'enhanced', label: 'Enhanced' },
] as const;

export function RuntimeDefaultsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const liveVisibilityQuery = useQuery({
    queryKey: AGENTIC_SETTINGS_QUERY_KEY,
    queryFn: () => dashboardApi.getAgenticSettings(),
  });
  const [liveVisibilityMode, setLiveVisibilityMode] =
    useState<DashboardAgenticSettingsRecord['live_visibility_mode_default']>('enhanced');

  useEffect(() => {
    const nextMode = liveVisibilityQuery.data?.live_visibility_mode_default;
    if (!nextMode) {
      return;
    }
    setLiveVisibilityMode(nextMode);
  }, [liveVisibilityQuery.data?.live_visibility_mode_default, liveVisibilityQuery.data?.revision]);

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

  return (
    <RuntimeDefaultsEditorPage
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
      sectionSupplementalContent={{
        connected_platform: (
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
        ),
      }}
      additionalHasChanges={hasLiveVisibilityChanges}
      onResetAdditional={() =>
        setLiveVisibilityMode(liveVisibilitySettings.live_visibility_mode_default)
      }
      onSaveAdditional={async () => {
        if (!hasLiveVisibilityChanges) {
          return;
        }
        const updated = await dashboardApi.updateAgenticSettings({
          live_visibility_mode_default: liveVisibilityMode,
          settings_revision: liveVisibilitySettings.revision,
        });
        queryClient.setQueryData(AGENTIC_SETTINGS_QUERY_KEY, updated);
        await queryClient.invalidateQueries({ queryKey: AGENTIC_SETTINGS_QUERY_KEY });
      }}
    />
  );
}
