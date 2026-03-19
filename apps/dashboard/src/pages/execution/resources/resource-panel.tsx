import { useState } from 'react';
import type { ResourcePanelRepoProps } from './resource-panel-repo.js';
import type { ResourcePanelArtifactsProps } from './resource-panel-artifacts.js';
import type { ResourcePanelMemoryProps } from './resource-panel-memory.js';
import type { ResourcePanelIntegrationsProps } from './resource-panel-integrations.js';
import { ResourcePanelRepo } from './resource-panel-repo.js';
import { ResourcePanelArtifacts } from './resource-panel-artifacts.js';
import { ResourcePanelMemory } from './resource-panel-memory.js';
import { ResourcePanelIntegrations } from './resource-panel-integrations.js';

export interface ResourcePanelProps
  extends ResourcePanelRepoProps,
    ResourcePanelArtifactsProps,
    ResourcePanelMemoryProps {
  isOpen: boolean;
  onClose: () => void;
  workflowId: string;
  workspaceId: string;
  integrations?: Array<{ name: string; type: string; status: string }>;
  onArtifactPreview?: (artifactId: string) => void;
}

type SectionKey = 'repo' | 'artifacts' | 'memory' | 'integrations';

const SECTION_LABELS: Record<SectionKey, string> = {
  repo: 'Repository',
  artifacts: 'Artifacts',
  memory: 'Project Memory',
  integrations: 'Integrations',
};

function SectionHeader({
  title,
  isExpanded,
  onToggle,
}: {
  title: string;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: '10px 16px',
        textAlign: 'left',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}
    >
      <span style={{
        fontSize: '11px',
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--color-text-tertiary)',
      }}>
        {title}
      </span>
      <span style={{
        fontSize: '12px',
        color: 'var(--color-text-tertiary)',
        transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
        transition: 'transform 150ms ease',
        lineHeight: 1,
      }}>
        ▾
      </span>
    </button>
  );
}

function CollapsibleSection({
  sectionKey,
  isExpanded,
  onToggle,
  children,
}: {
  sectionKey: SectionKey;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <SectionHeader
        title={SECTION_LABELS[sectionKey]}
        isExpanded={isExpanded}
        onToggle={onToggle}
      />
      {isExpanded && (
        <div style={{ padding: '12px 16px' }}>
          {children}
        </div>
      )}
    </div>
  );
}

const DEFAULT_OPEN: SectionKey[] = ['repo'];

export function ResourcePanel({
  isOpen,
  onClose,
  repoInfo,
  touchedFiles,
  artifacts,
  entries,
  integrations,
  onArtifactPreview,
}: ResourcePanelProps) {
  const [expandedSections, setExpandedSections] = useState<Set<SectionKey>>(
    new Set(DEFAULT_OPEN),
  );

  if (!isOpen) return null;

  function toggleSection(key: SectionKey) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  return (
    <>
      <style>{`
        @media (max-width: 767px) {
          .resource-panel {
            width: 100% !important;
          }
        }
      `}</style>
      <div
        className="resource-panel"
        data-testid="resource-panel"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: '320px',
          zIndex: 'var(--z-resource, 25)' as unknown as number,
          boxShadow: 'var(--shadow-panel)',
          backgroundColor: 'var(--color-bg-primary)',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: 'var(--font-family)',
          overflowY: 'hidden',
          borderLeft: '1px solid var(--color-border-subtle)',
        }}
      >
        <header style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--color-border-subtle)',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
        }}>
          <span style={{
            fontSize: '13px',
            fontWeight: 600,
            color: 'var(--color-text-primary)',
          }}>
            Resources
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close resources panel"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-text-tertiary)',
              fontSize: '18px',
              lineHeight: 1,
              padding: '2px 4px',
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </header>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          <CollapsibleSection
            sectionKey="repo"
            isExpanded={expandedSections.has('repo')}
            onToggle={() => toggleSection('repo')}
          >
            <ResourcePanelRepo repoInfo={repoInfo} touchedFiles={touchedFiles} />
          </CollapsibleSection>

          <CollapsibleSection
            sectionKey="artifacts"
            isExpanded={expandedSections.has('artifacts')}
            onToggle={() => toggleSection('artifacts')}
          >
            <ResourcePanelArtifacts artifacts={artifacts} onPreview={onArtifactPreview} />
          </CollapsibleSection>

          <CollapsibleSection
            sectionKey="memory"
            isExpanded={expandedSections.has('memory')}
            onToggle={() => toggleSection('memory')}
          >
            <ResourcePanelMemory entries={entries} />
          </CollapsibleSection>

          <CollapsibleSection
            sectionKey="integrations"
            isExpanded={expandedSections.has('integrations')}
            onToggle={() => toggleSection('integrations')}
          >
            <ResourcePanelIntegrations integrations={integrations} />
          </CollapsibleSection>
        </div>
      </div>
    </>
  );
}
