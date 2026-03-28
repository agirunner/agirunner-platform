import { AgenticLiveVisibilitySettingsCard } from './agentic-live-visibility-settings-card.js';
import { RuntimeDefaultsPage } from './runtime-defaults-page.js';

export function RuntimesPage(): JSX.Element {
  return (
    <>
      <RuntimeDefaultsPage />
      <AgenticLiveVisibilitySettingsCard />
    </>
  );
}
