import { Server } from 'lucide-react';

import {
  FIELD_DEFINITIONS,
  PRIMARY_RUNTIME_DEFAULT_SECTION_KEYS,
  RUNTIME_INLINE_SECTION_COLUMNS,
  SECTION_DEFINITIONS,
} from './runtime-defaults.schema.js';
import { RuntimeDefaultsEditorPage } from './runtime-defaults-editor-page.js';

export function RuntimeDefaultsPage(): JSX.Element {
  return (
    <RuntimeDefaultsEditorPage
      title="Specialist Agents"
      description="Configure platform-wide defaults for specialist agents and agent execution behavior. Specialist execution environments are managed on Platform > Environments."
      icon={Server}
      fieldDefinitions={FIELD_DEFINITIONS}
      sectionDefinitions={SECTION_DEFINITIONS}
      primarySectionKeys={PRIMARY_RUNTIME_DEFAULT_SECTION_KEYS}
      inlineSectionColumns={RUNTIME_INLINE_SECTION_COLUMNS}
      sectionIdPrefix="runtime-defaults"
      successMessage="Specialist configuration saved."
      errorLabel="specialist configuration"
    />
  );
}
