import type { StructuredEntryDraft } from './workspace-detail/workspace-detail-support.js';
import { Card, CardContent, CardTitle } from '../../components/ui/card.js';
import { StructuredEntryEditor } from './workspace-structured-entry-editor.js';

export function WorkspaceDetailMemoryTab(props: {
  memoryDrafts: StructuredEntryDraft[];
  saveErrorMessage?: string | null;
  onMemoryDraftsChange(drafts: StructuredEntryDraft[]): void;
}): JSX.Element {
  return (
    <div className="space-y-4">
      <Card className="border-border/70 shadow-none">
        <CardContent className="space-y-6 p-4">
          <div className="space-y-2">
            <CardTitle className="text-base">Workspace Memory</CardTitle>
            <p className="text-sm leading-6 text-muted">
              Memory is for evolving notes and learned state. Keep durable policy and reference facts in
              Knowledge, and use memory for what the workspace learns while work is happening.
            </p>
            <p className="max-w-3xl text-sm leading-5 text-muted">
              Existing memory entries stay editable here and save with the rest of the Knowledge tab.
            </p>
          </div>

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
        </CardContent>
      </Card>
      {props.saveErrorMessage ? (
        <p className="rounded-xl border border-red-300/70 bg-background/70 px-3 py-2 text-sm text-red-700 dark:border-red-800/70 dark:text-red-300">
          {props.saveErrorMessage}
        </p>
      ) : null}
    </div>
  );
}
