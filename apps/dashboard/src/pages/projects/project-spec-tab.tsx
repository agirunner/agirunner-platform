import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Save } from 'lucide-react';

import { dashboardApi } from '../../lib/api.js';
import type { DashboardProjectSpecRecord } from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import {
  buildStructuredObject,
  objectToStructuredDrafts,
  type StructuredEntryDraft,
} from './project-detail-support.js';
import { ErrorCard, LoadingCard } from './project-detail-shared.js';
import { StructuredEntryEditor } from './project-structured-entry-editor.js';

type SpecSection = 'config' | 'instructions' | 'resources' | 'documents' | 'tools';

export function ProjectSpecTab({ projectId }: { projectId: string }): JSX.Element {
  const queryClient = useQueryClient();
  const [configDrafts, setConfigDrafts] = useState<StructuredEntryDraft[]>([]);
  const [instructionDrafts, setInstructionDrafts] = useState<StructuredEntryDraft[]>([]);
  const [resourceDrafts, setResourceDrafts] = useState<StructuredEntryDraft[]>([]);
  const [documentDrafts, setDocumentDrafts] = useState<StructuredEntryDraft[]>([]);
  const [toolDrafts, setToolDrafts] = useState<StructuredEntryDraft[]>([]);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<SpecSection | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['project-spec', projectId],
    queryFn: () => dashboardApi.getProjectSpec(projectId),
  });

  useEffect(() => {
    if (!data) {
      return;
    }
    setConfigDrafts(objectToStructuredDrafts(data.config));
    setInstructionDrafts(objectToStructuredDrafts(data.instructions));
    setResourceDrafts(objectToStructuredDrafts(data.resources));
    setDocumentDrafts(objectToStructuredDrafts(data.documents));
    setToolDrafts(objectToStructuredDrafts(data.tools));
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const resources = buildStructuredObject(resourceDrafts, 'Project resources');
      const documents = buildStructuredObject(documentDrafts, 'Project documents');
      const tools = buildStructuredObject(toolDrafts, 'Project tools');
      const nextSpec = {
        ...(resources ? { resources } : {}),
        ...(documents ? { documents } : {}),
        ...(tools ? { tools } : {}),
        config: buildStructuredObject(configDrafts, 'Project config') ?? {},
        instructions: buildStructuredObject(instructionDrafts, 'Project instructions') ?? {},
      };
      return dashboardApi.updateProjectSpec(projectId, nextSpec);
    },
    onSuccess: async () => {
      setSaveMessage('Project spec saved.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project-spec', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
      ]);
    },
  });

  if (isLoading) {
    return <LoadingCard />;
  }
  if (error) {
    return <ErrorCard message="Failed to load project spec." />;
  }

  const spec = data as DashboardProjectSpecRecord;

  function toggleSection(section: SpecSection): void {
    setExpandedSection((current) => (current === section ? null : section));
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border/70 bg-background/70 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Workspace structure</p>
            <p className="text-xs leading-5 text-muted">
              Spec version {spec.version ?? 0} • Updated{' '}
              {spec.updated_at ? new Date(spec.updated_at).toLocaleString() : 'not recorded'}
            </p>
          </div>
          {saveMessage ? <p className="text-sm text-muted">{saveMessage}</p> : null}
          <Button size="sm" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            <Save className="h-4 w-4" />
            Save Spec
          </Button>
        </div>
        <div className="mt-3 rounded-xl border border-border/70 bg-muted/10 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
            Start here
          </p>
          <p className="mt-2 text-sm leading-6 text-muted">
            Start with the section you need to change. Everything stays collapsed until you open
            it, so the workspace stays short and readable.
          </p>
        </div>
      </div>

      <StructuredEditorSection
        title="Config"
        editorTitle="Config Entries"
        description="Edit project configuration as structured key/value entries instead of a raw JSON document."
        summary={buildSectionSummary(configDrafts.length, 'Runtime settings and defaults')}
        drafts={configDrafts}
        isExpanded={expandedSection === 'config'}
        onToggle={() => toggleSection('config')}
        onChange={(drafts) => {
          setSaveMessage(null);
          setConfigDrafts(drafts);
        }}
        addLabel="Add config field"
      />
      <StructuredEditorSection
        title="Instructions"
        editorTitle="Instruction Entries"
        description="Edit structured project instructions and document references without switching to raw JSON."
        summary={buildSectionSummary(instructionDrafts.length, 'Operator guidance and reusable prompts')}
        drafts={instructionDrafts}
        isExpanded={expandedSection === 'instructions'}
        onToggle={() => toggleSection('instructions')}
        onChange={(drafts) => {
          setSaveMessage(null);
          setInstructionDrafts(drafts);
        }}
        addLabel="Add instruction field"
      />
      <StructuredEditorSection
        title="Resources"
        editorTitle="Resource Entries"
        description="Edit project-scoped resource bindings and descriptors with structured entries."
        summary={buildSectionSummary(resourceDrafts.length, 'Scoped systems and external bindings')}
        drafts={resourceDrafts}
        isExpanded={expandedSection === 'resources'}
        onToggle={() => toggleSection('resources')}
        onChange={(drafts) => {
          setSaveMessage(null);
          setResourceDrafts(drafts);
        }}
        addLabel="Add resource entry"
      />
      <StructuredEditorSection
        title="Documents"
        editorTitle="Document Entries"
        description="Edit project document references and metadata without switching to a raw JSON blob."
        summary={buildSectionSummary(documentDrafts.length, 'Reference material and attached metadata')}
        drafts={documentDrafts}
        isExpanded={expandedSection === 'documents'}
        onToggle={() => toggleSection('documents')}
        onChange={(drafts) => {
          setSaveMessage(null);
          setDocumentDrafts(drafts);
        }}
        addLabel="Add document entry"
      />
      <StructuredEditorSection
        title="Tools"
        editorTitle="Tool Entries"
        description="Edit project tool policy entries as structured values rather than a read-only spec view."
        summary={buildSectionSummary(toolDrafts.length, 'Allow and block policy')}
        drafts={toolDrafts}
        isExpanded={expandedSection === 'tools'}
        onToggle={() => toggleSection('tools')}
        onChange={(drafts) => {
          setSaveMessage(null);
          setToolDrafts(drafts);
        }}
        addLabel="Add tool entry"
      />

      {saveMutation.error ? (
        <p className="rounded-xl border border-red-300/70 bg-background/70 px-3 py-2 text-sm text-red-700 dark:border-red-800/70 dark:text-red-300">
          {saveMutation.error instanceof Error
            ? saveMutation.error.message
            : 'Failed to save project spec.'}
        </p>
      ) : null}
    </div>
  );
}

function StructuredEditorSection(props: {
  title: string;
  editorTitle: string;
  description: string;
  summary: string;
  drafts: StructuredEntryDraft[];
  isExpanded: boolean;
  onToggle(): void;
  onChange(drafts: StructuredEntryDraft[]): void;
  addLabel: string;
}): JSX.Element {
  return (
    <Card className="border-border/70 shadow-none">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 px-6 py-5 text-left"
        aria-expanded={props.isExpanded}
        onClick={props.onToggle}
      >
        <div className="space-y-2">
          <CardTitle className="text-base">{props.title}</CardTitle>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">
            {props.summary}
          </p>
          <p className="text-sm leading-6 text-muted">{props.description}</p>
        </div>
        <ChevronDown
          className={cn('mt-1 h-4 w-4 shrink-0 text-muted transition-transform', props.isExpanded && 'rotate-180')}
        />
      </button>
      {props.isExpanded ? (
        <CardContent className="border-t border-border/70 pt-6">
          <StructuredEntryEditor
            title={props.editorTitle}
            description={props.description}
            drafts={props.drafts}
            onChange={props.onChange}
            addLabel={props.addLabel}
          />
        </CardContent>
      ) : null}
    </Card>
  );
}

function buildSectionSummary(count: number, detail: string): string {
  if (count === 0) {
    return `No entries yet • ${detail}`;
  }
  return `${count} ${count === 1 ? 'entry' : 'entries'} • ${detail}`;
}
