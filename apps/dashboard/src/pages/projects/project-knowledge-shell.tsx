import { useEffect, useState, type ReactNode } from 'react';
import { BrainCircuit, ChevronDown, FileText, PackageSearch } from 'lucide-react';
import { useLocation } from 'react-router-dom';

import { cn } from '../../lib/utils.js';
import type { ProjectWorkspaceOverview } from './project-detail-support.js';

type KnowledgePanelValue = 'reference' | 'artifacts' | 'memory';

interface ProjectKnowledgeShellProps {
  projectId: string;
  overview: ProjectWorkspaceOverview;
  headerAction?: ReactNode;
  headerNotice?: ReactNode;
  referenceContent: ReactNode;
  artifactContent: ReactNode;
  memoryContent: ReactNode;
}

const KNOWLEDGE_PANELS: Array<{
  value: KnowledgePanelValue;
  label: string;
  description: string;
  icon: typeof BrainCircuit;
}> = [
  {
    value: 'reference',
    label: 'Project Context & Knowledge',
    description: 'Curated project context, policies, and reusable facts stay here.',
    icon: FileText,
  },
  {
    value: 'artifacts',
    label: 'Project artifacts',
    description: 'Generated outputs, delivery evidence, and uploaded artifacts stay here.',
    icon: PackageSearch,
  },
  {
    value: 'memory',
    label: 'Project memory',
    description: 'Evolving notes and learned state stay here as work progresses.',
    icon: BrainCircuit,
  },
];

export function ProjectKnowledgeShell(props: ProjectKnowledgeShellProps): JSX.Element {
  const location = useLocation();
  const [expandedPanel, setExpandedPanel] = useState<KnowledgePanelValue | null>('reference');
  const sectionSummaries: Record<KnowledgePanelValue, string> = {
    reference: buildReferenceSummary(props.overview),
    artifacts: buildArtifactSummary(props.overview),
    memory:
      getPacketSummary(props.overview, 'Shared memory')
      || 'Project memory captures evolving notes and learned state.',
  };

  useEffect(() => {
    const panel = readKnowledgePanel(location.search);
    if (!panel) {
      return;
    }
    setExpandedPanel(panel);
  }, [location.search]);

  function togglePanel(value: KnowledgePanelValue): void {
    setExpandedPanel((current) => (current === value ? null : value));
  }

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-xl border border-border/70 bg-background/70 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-foreground">Knowledge</h2>
            <p className="max-w-3xl text-sm leading-6 text-muted">
              Use Knowledge for curated context, Project artifacts for generated outputs, and Memory for evolving notes.
            </p>
            {props.headerNotice}
            <p className="sr-only">{props.overview.summary}</p>
          </div>
          {props.headerAction ? <div className="shrink-0">{props.headerAction}</div> : null}
        </div>

        <div className="grid gap-3">
          {KNOWLEDGE_PANELS.map((panel) => (
            <KnowledgeSection
              key={panel.value}
              title={panel.label}
              summary={sectionSummaries[panel.value]}
              description={panel.description}
              icon={panel.icon}
              isExpanded={expandedPanel === panel.value}
              onToggle={() => togglePanel(panel.value)}
            >
              {panel.value === 'reference'
                ? props.referenceContent
                : panel.value === 'artifacts'
                  ? props.artifactContent
                  : panel.value === 'memory'
                  ? props.memoryContent
                  : null}
            </KnowledgeSection>
          ))}
        </div>
      </section>
    </div>
  );
}

function KnowledgeSection(props: {
  title: string;
  summary: string;
  description: string;
  icon: typeof BrainCircuit;
  isExpanded: boolean;
  onToggle(): void;
  children: ReactNode;
}): JSX.Element {
  const Icon = props.icon;

  return (
    <section className="rounded-xl border border-border/70 bg-card/70 shadow-none">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 px-4 py-4 text-left"
        aria-expanded={props.isExpanded}
        onClick={props.onToggle}
      >
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Icon className="h-4 w-4 text-muted" />
            {props.title}
          </div>
          <p className="max-w-3xl text-sm leading-5 text-muted">{props.summary}</p>
        </div>
        <ChevronDown
          className={cn(
            'mt-1 h-4 w-4 shrink-0 text-muted transition-transform',
            props.isExpanded && 'rotate-180',
          )}
        />
      </button>
      {props.isExpanded ? (
        <div className="space-y-3 border-t border-border/70 px-4 py-4">
          <p className="text-sm leading-6 text-muted">{props.description}</p>
          {props.children}
        </div>
      ) : null}
    </section>
  );
}

function buildReferenceSummary(overview: ProjectWorkspaceOverview): string {
  const projectContext = getPacketSummary(overview, 'Project Context');
  const knowledgeEntries = getPacketSummary(overview, 'Knowledge entries');
  const summary = [projectContext, knowledgeEntries].filter(Boolean).join(' • ');
  return summary || 'Curated project context and reusable knowledge entries.';
}

function buildArtifactSummary(overview: ProjectWorkspaceOverview): string {
  const artifacts = getPacketSummary(overview, 'Project artifacts');
  return artifacts || 'Workflow documents, task artifacts, and delivery evidence';
}

function getPacketSummary(overview: ProjectWorkspaceOverview, label: string): string {
  const packet = overview.packets.find((entry) => entry.label === label);
  return packet ? `${packet.label}: ${packet.value}` : '';
}

function readKnowledgePanel(search: string): KnowledgePanelValue | null {
  const panel = new URLSearchParams(search).get('panel');
  return panel === 'reference' || panel === 'artifacts' || panel === 'memory' ? panel : null;
}
