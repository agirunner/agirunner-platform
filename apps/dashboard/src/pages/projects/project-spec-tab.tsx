import type { StructuredEntryDraft } from './project-detail-support.js';
import { Card, CardContent, CardTitle } from '../../components/ui/card.js';
import { Textarea } from '../../components/ui/textarea.js';
import { StructuredEntryEditor } from './project-structured-entry-editor.js';
import { summarizeProjectContext } from './project-settings-support.js';

export function ProjectSpecTab(props: {
  projectContext: string;
  knowledgeDrafts: StructuredEntryDraft[];
  saveErrorMessage?: string | null;
  onProjectContextChange(value: string): void;
  onKnowledgeDraftsChange(drafts: StructuredEntryDraft[]): void;
}): JSX.Element {
  const contextSummary = summarizeProjectContext(props.projectContext);

  return (
    <div className="space-y-4">
      <Card className="border-border/70 shadow-none">
        <CardContent className="space-y-6 p-4">
          <div className="space-y-2">
            <CardTitle className="text-base">Project Context</CardTitle>
            <p className="text-sm leading-6 text-muted">
              Reusable project context for playbooks. This is the place for durable LLM context that
              should flow into workflow inputs.
            </p>
            <p className="max-w-3xl text-sm leading-5 text-muted">{contextSummary}</p>
            <Textarea
              value={props.projectContext}
              className="min-h-[160px]"
              onChange={(event) => props.onProjectContextChange(event.target.value)}
            />
            <p className="text-sm leading-6 text-muted">
              Use this for stable project context. It is separate from the project description and
              can be mapped by playbooks into workflow inputs.
            </p>
          </div>

          <div className="space-y-2 border-t border-border/70 pt-4">
            <CardTitle className="text-base">Project Knowledge</CardTitle>
            <p className="text-sm leading-6 text-muted">
              Edit curated project facts and policies as simple key/value entries instead of managing
              separate config, instruction, resource, and document sections.
            </p>
            <p className="max-w-3xl text-sm leading-5 text-muted">
              {buildKnowledgeSummary(props.knowledgeDrafts.length)}
            </p>
            <p className="max-w-3xl text-sm leading-5 text-muted">
              Playbooks can map these keys through <code>project.settings.knowledge.&lt;key&gt;</code>.
            </p>
          </div>

          <StructuredEntryEditor
            title="Key/Value pairs"
            description="Use simple string or JSON values for reusable project knowledge."
            drafts={props.knowledgeDrafts}
            onChange={props.onKnowledgeDraftsChange}
            addLabel="Add knowledge entry"
            allowedTypes={['string', 'json']}
            stringInputMode="multiline"
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

function buildKnowledgeSummary(entryCount: number): string {
  if (entryCount === 0) {
    return 'No curated knowledge entries saved yet.';
  }
  return `${entryCount} ${entryCount === 1 ? 'entry' : 'entries'} ready for runtime and workflow access.`;
}
