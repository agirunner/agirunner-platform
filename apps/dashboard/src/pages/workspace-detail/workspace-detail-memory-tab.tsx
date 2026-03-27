import type { StructuredEntryDraft } from './workspace-detail-support.js';
import { StructuredEntryEditor } from './workspace-structured-entry-editor.js';

export function WorkspaceDetailMemoryTab(props: {
  memoryDrafts: StructuredEntryDraft[];
  saveErrorMessage?: string | null;
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
      {props.saveErrorMessage ? (
        <p className="rounded-xl border border-red-300/70 bg-background/70 px-3 py-2 text-sm text-red-700 dark:border-red-800/70 dark:text-red-300">
          {props.saveErrorMessage}
        </p>
      ) : null}
    </div>
  );
}
