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
      description="Configure platform-wide defaults for specialist runtime containers and execution containers. Everything else is optional and only overrides the built-in defaults when you set a value."
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
