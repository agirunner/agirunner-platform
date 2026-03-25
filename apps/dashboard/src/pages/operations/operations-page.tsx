import { Cog } from 'lucide-react';

import {
  OPERATIONS_FIELD_DEFINITIONS,
  OPERATIONS_SECTION_DEFINITIONS,
  PRIMARY_OPERATIONS_SECTION_KEYS,
} from '../runtimes/runtime-defaults.schema.js';
import { RuntimeDefaultsEditorPage } from '../runtimes/runtime-defaults-editor-page.js';

export function OperationsPage(): JSX.Element {
  return (
    <RuntimeDefaultsEditorPage
      title="Operations"
      description="Configure platform-side operational defaults for activation timing, supervision, fleet behavior, and control-plane loops. Every value shown here is explicit, required, and persisted."
      icon={Cog}
      fieldDefinitions={OPERATIONS_FIELD_DEFINITIONS}
      sectionDefinitions={OPERATIONS_SECTION_DEFINITIONS}
      primarySectionKeys={PRIMARY_OPERATIONS_SECTION_KEYS}
      renderAllSectionsInline
      sectionIdPrefix="platform-operations"
      successMessage="Operations configuration saved."
      errorLabel="operations configuration"
    />
  );
}
