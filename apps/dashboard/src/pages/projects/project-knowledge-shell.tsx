import { useState, type ReactNode } from 'react';
import { BrainCircuit, ChevronDown, FileText, PackageSearch } from 'lucide-react';

import { cn } from '../../lib/utils.js';
import type { ProjectWorkspaceOverview } from './project-detail-support.js';

type KnowledgePanelValue = 'reference' | 'memory' | 'runContent';

interface ProjectKnowledgeShellProps {
  projectId: string;
  overview: ProjectWorkspaceOverview;
  referenceContent: ReactNode;
  memoryContent: ReactNode;
  runContentContent: ReactNode;
}

const KNOWLEDGE_PANELS: Array<{
  value: KnowledgePanelValue;
  label: string;
  description: string;
  guidance: string;
  icon: typeof BrainCircuit;
}> = [
  {
    value: 'reference',
    label: 'Reference material',
    description:
      'Edit the project spec, instructions, resources, reference documents, and tool policy in the canonical project-scoped workspace.',
    guidance: 'Project spec and long-lived reference material stay here.',
    icon: FileText,
  },
  {
    value: 'memory',
    label: 'Project memory',
    description:
      'Review and update typed shared memory without leaving the project knowledge workspace.',
    guidance: 'Reusable notes, flags, and structured context stay here.',
    icon: BrainCircuit,
  },
  {
    value: 'runContent',
    label: 'Run content',
    description:
      'Manage workflow documents and task artifacts from project runs without conflating them with project reference material.',
    guidance: 'Use this for scoped outputs, delivery evidence, and run-generated documents.',
    icon: PackageSearch,
  },
];

export function ProjectKnowledgeShell(props: ProjectKnowledgeShellProps): JSX.Element {
  const [expandedPanel, setExpandedPanel] = useState<KnowledgePanelValue | null>('reference');
  const sectionSummaries: Record<KnowledgePanelValue, string> = {
    reference: buildReferenceSummary(props.overview),
    memory: getPacketSummary(props.overview, 'Shared memory'),
    runContent: buildRunContentSummary(props.overview),
  };

  function togglePanel(value: KnowledgePanelValue): void {
    setExpandedPanel((current) => (current === value ? null : value));
  }

  return (
    <div className="space-y-4">
      <section className="space-y-4 rounded-xl border border-border/70 bg-background/70 p-4">
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">Knowledge workspace</h2>
          <p className="max-w-3xl text-sm leading-6 text-muted">
            Keep project reference material, project memory, and scoped run content together so
            the project page stays the canonical management surface.
          </p>
          <p className="max-w-3xl text-sm leading-6 text-muted">{props.overview.summary}</p>
        </div>

        <div className="grid gap-3">
          {KNOWLEDGE_PANELS.map((panel) => (
            <KnowledgeSection
              key={panel.value}
              title={panel.label}
              summary={sectionSummaries[panel.value]}
              description={panel.description}
              guidance={panel.guidance}
              icon={panel.icon}
              isExpanded={expandedPanel === panel.value}
              onToggle={() => togglePanel(panel.value)}
            >
              {panel.value === 'reference'
                ? props.referenceContent
                : panel.value === 'memory'
                  ? props.memoryContent
                  : props.runContentContent}
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
  guidance: string;
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
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Icon className="h-4 w-4 text-muted" />
            {props.title}
          </div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">
            {formatSectionSummary(props.summary, props.guidance)}
          </p>
          <p className="text-sm leading-6 text-muted">{props.description}</p>
        </div>
        <ChevronDown
          className={cn('mt-1 h-4 w-4 shrink-0 text-muted transition-transform', props.isExpanded && 'rotate-180')}
        />
      </button>
      {props.isExpanded ? <div className="border-t border-border/70 px-4 py-4">{props.children}</div> : null}
    </section>
  );
}

function buildReferenceSummary(overview: ProjectWorkspaceOverview): string {
  const structuredSpec = getPacketSummary(overview, 'Structured spec');
  const referenceAssets = getPacketSummary(overview, 'Reference assets');
  const toolPolicy = getPacketSummary(overview, 'Tool policy');
  return [structuredSpec, referenceAssets, toolPolicy].filter(Boolean).join(' • ');
}

function buildRunContentSummary(overview: ProjectWorkspaceOverview): string {
  const artifacts = getPacketSummary(overview, 'Artifacts');
  return artifacts || 'Workflow documents, task artifacts, and delivery evidence';
}

function formatSectionSummary(summary: string, fallback: string): string {
  return summary || fallback;
}

function getPacketSummary(overview: ProjectWorkspaceOverview, label: string): string {
  const packet = overview.packets.find((entry) => entry.label === label);
  return packet ? `${packet.label}: ${packet.value}` : '';
}
