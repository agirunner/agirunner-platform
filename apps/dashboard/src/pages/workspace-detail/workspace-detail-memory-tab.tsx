import type { StructuredEntryDraft } from './workspace-detail-support.js';
import { StructuredEntryEditor } from './workspace-structured-entry-editor.js';

export function WorkspaceDetailMemoryTab(props: {
  memoryDrafts: StructuredEntryDraft[];
  onMemoryDraftsChange(drafts: StructuredEntryDraft[]): void;
}): JSX.Element {
  return (
    <div className="space-y-4">
      <StructuredEntryEditor
        title="Key/Value pairs"
        description="Use string or JSON values for workspace memory."
        drafts={props.memoryDrafts}
        onChange={props.onMemoryDraftsChange}
        addLabel="Add memory entry"
        allowedTypes={['string', 'json']}
        stringInputMode="multiline"
        pageSize={10}
      />
    </div>
  );
}
