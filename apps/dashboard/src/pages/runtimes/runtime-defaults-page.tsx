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
    />
  );
}
