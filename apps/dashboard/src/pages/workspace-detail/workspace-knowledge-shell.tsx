import type { ReactNode } from 'react';
import { BrainCircuit, PackageSearch } from 'lucide-react';

import { Card, CardContent } from '../../components/ui/card.js';
import type { WorkspaceOverview } from './workspace-detail-support.js';

interface WorkspaceKnowledgeShellProps {
  overview: WorkspaceOverview;
  headerAction?: ReactNode;
  headerNotice?: ReactNode;
  artifactSummary?: string;
  memorySummary?: string;
  artifactContent: ReactNode;
  memoryContent: ReactNode;
}

const KNOWLEDGE_PANELS: Array<{
  value: 'artifacts' | 'memory';
  label: string;
  icon: typeof BrainCircuit;
}> = [
  {
    value: 'artifacts',
    label: 'Workspace Artifacts',
    icon: PackageSearch,
  },
  {
    value: 'memory',
    label: 'Workspace Memory',
    icon: BrainCircuit,
  },
];

export function WorkspaceKnowledgeShell(props: WorkspaceKnowledgeShellProps): JSX.Element {
  const sectionSummaries: Record<'artifacts' | 'memory', string> = {
    artifacts: props.artifactSummary ?? buildArtifactSummary(props.overview),
    memory: props.memorySummary ?? buildMemorySummary(props.overview),
  };

  return (
    <div className="space-y-4">
      <section className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-foreground">Knowledge</h2>
            <p className="max-w-3xl text-sm leading-6 text-muted">
              Workspace artifacts and seeded memory are available to specialists operating in this
              workspace. Depending on the workflow, specialists may also add artifacts and memory as
              work progresses.
            </p>
            {props.headerNotice}
            <p className="sr-only">{props.overview.summary}</p>
          </div>
          {props.headerAction ? <div className="shrink-0">{props.headerAction}</div> : null}
        </div>

        <div className="grid gap-3">
          {KNOWLEDGE_PANELS.map((panel) => (
            <StaticKnowledgeSection
              key={panel.value}
              title={panel.label}
              summary={sectionSummaries[panel.value]}
              icon={panel.icon}
            >
              {panel.value === 'artifacts'
                ? props.artifactContent
                : panel.value === 'memory'
                  ? props.memoryContent
                  : null}
            </StaticKnowledgeSection>
          ))}
        </div>
      </section>
    </div>
  );
}

function StaticKnowledgeSection(props: {
  title: string;
  summary: string;
  icon: typeof BrainCircuit;
  children: ReactNode;
}): JSX.Element {
  const Icon = props.icon;

  return (
    <Card className="border-border/70 shadow-none">
      <div className="px-4 py-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Icon className="h-4 w-4 text-muted" />
            {props.title}
          </div>
          <p className="max-w-3xl text-sm leading-5 text-muted">{props.summary}</p>
        </div>
      </div>
      <CardContent className="space-y-3 px-4 pb-4 pt-0">
        {props.children}
      </CardContent>
    </Card>
  );
}

function buildArtifactSummary(overview: WorkspaceOverview): string {
  return (
    getPacketValue(overview, 'Workspace artifacts') ||
    'Upload and manage files that stay scoped to this workspace.'
  );
}

function buildMemorySummary(overview: WorkspaceOverview): string {
  return (
    getPacketValue(overview, 'Shared memory') ||
    'Track shared key/value context the workspace learns over time.'
  );
}

function getPacketValue(overview: WorkspaceOverview, label: string): string {
  const packet = overview.packets.find((entry) => entry.label === label);
  return packet?.value ?? '';
}
