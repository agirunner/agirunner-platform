export interface Artifact {
  id: string;
  name: string;
  taskTitle: string;
  contentType?: string;
}

export interface ResourcePanelArtifactsProps {
  artifacts?: Artifact[];
  onPreview?: (artifactId: string) => void;
}

function groupByTask(artifacts: Artifact[]): Map<string, Artifact[]> {
  const groups = new Map<string, Artifact[]>();
  for (const artifact of artifacts) {
    const existing = groups.get(artifact.taskTitle) ?? [];
    existing.push(artifact);
    groups.set(artifact.taskTitle, existing);
  }
  return groups;
}

function ArtifactRow({ artifact, onPreview }: { artifact: Artifact; onPreview?: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPreview?.(artifact.id)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        background: 'none',
        border: 'none',
        cursor: onPreview ? 'pointer' : 'default',
        padding: '4px 0',
        textAlign: 'left',
      }}
    >
      <span style={{
        fontSize: '12px',
        color: 'var(--color-text-primary)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        flex: 1,
        minWidth: 0,
      }}>
        {artifact.name}
      </span>
      {artifact.contentType && (
        <span style={{
          fontSize: '10px',
          padding: '1px 4px',
          borderRadius: '3px',
          backgroundColor: 'var(--color-bg-secondary)',
          color: 'var(--color-text-tertiary)',
          flexShrink: 0,
        }}>
          {artifact.contentType}
        </span>
      )}
    </button>
  );
}

export function ResourcePanelArtifacts({ artifacts = [], onPreview }: ResourcePanelArtifactsProps) {
  if (artifacts.length === 0) {
    return (
      <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', padding: '8px 0' }}>
        No artifacts yet.
      </div>
    );
  }

  const groups = groupByTask(artifacts);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {Array.from(groups.entries()).map(([taskTitle, taskArtifacts]) => (
        <div key={taskTitle}>
          <div style={{
            fontSize: '11px',
            fontWeight: 600,
            color: 'var(--color-text-tertiary)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            marginBottom: '4px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {taskTitle}
          </div>
          {taskArtifacts.map((artifact) => (
            <ArtifactRow key={artifact.id} artifact={artifact} onPreview={onPreview} />
          ))}
        </div>
      ))}
    </div>
  );
}
