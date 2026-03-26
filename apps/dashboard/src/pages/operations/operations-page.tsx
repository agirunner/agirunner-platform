import {
  OPERATIONS_FIELD_DEFINITIONS,
  OPERATIONS_INLINE_SECTION_COLUMNS,
  OPERATIONS_SECTION_DEFINITIONS,
  PRIMARY_OPERATIONS_SECTION_KEYS,
} from '../runtimes/runtime-defaults.schema.js';
import { RuntimeDefaultsEditorPage } from '../runtimes/runtime-defaults-editor-page.js';

export function OperationsPage(): JSX.Element {
  return (
    <RuntimeDefaultsEditorPage
      navHref="/admin/platform-settings"
      description="Configure platform-side operational defaults for activation timing, supervision, fleet behavior, and control-plane loops. Every value shown here is explicit, required, and persisted."
      fieldDefinitions={OPERATIONS_FIELD_DEFINITIONS}
      sectionDefinitions={OPERATIONS_SECTION_DEFINITIONS}
      primarySectionKeys={PRIMARY_OPERATIONS_SECTION_KEYS}
      inlineSectionColumns={OPERATIONS_INLINE_SECTION_COLUMNS}
      sectionIdPrefix="platform-operations"
      successMessage="Platform settings saved."
      errorLabel="platform settings"
    />
  );
}
