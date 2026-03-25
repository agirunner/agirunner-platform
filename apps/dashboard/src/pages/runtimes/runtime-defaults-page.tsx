import { Server } from 'lucide-react';

import {
  FIELD_DEFINITIONS,
  PRIMARY_RUNTIME_DEFAULT_SECTION_KEYS,
  SECTION_DEFINITIONS,
} from './runtime-defaults.schema.js';
import { RuntimeDefaultsEditorPage } from './runtime-defaults-editor-page.js';

export function RuntimeDefaultsPage(): JSX.Element {
  return (
    <RuntimeDefaultsEditorPage
      title="Runtimes"
      description="Configure platform-wide defaults for specialist runtime containers, execution containers, and runtime execution behavior. Every value shown here is explicit, required, and persisted."
      icon={Server}
      fieldDefinitions={FIELD_DEFINITIONS}
      sectionDefinitions={SECTION_DEFINITIONS}
      primarySectionKeys={PRIMARY_RUNTIME_DEFAULT_SECTION_KEYS}
      sectionIdPrefix="runtime-defaults"
      successMessage="Runtime configuration saved."
      errorLabel="runtime configuration"
    />
  );
}
