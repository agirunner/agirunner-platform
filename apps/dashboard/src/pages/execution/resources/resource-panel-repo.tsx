export interface ResourcePanelRepoProps {
  repoInfo?: { name: string; url: string; branch: string };
  touchedFiles?: Array<{ path: string; tool: string }>;
}

function buildFileUrl(repoUrl: string, branch: string, filePath: string): string {
  const base = repoUrl.replace(/\/$/, '');
  return `${base}/blob/${branch}/${filePath}`;
}

function TouchedFileRow({ file, repoUrl, branch }: {
  file: { path: string; tool: string };
  repoUrl: string;
  branch: string;
}) {
  const href = buildFileUrl(repoUrl, branch, file.path);
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '3px 0',
    }}>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: '11px',
          color: 'var(--color-accent-primary)',
          textDecoration: 'none',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
          minWidth: 0,
        }}
        title={file.path}
      >
        {file.path}
      </a>
      <span style={{
        fontSize: '10px',
        padding: '1px 4px',
        borderRadius: '3px',
        backgroundColor: 'var(--color-bg-secondary)',
        color: 'var(--color-text-tertiary)',
        flexShrink: 0,
      }}>
        {file.tool}
      </span>
    </div>
  );
}

export function ResourcePanelRepo({ repoInfo, touchedFiles = [] }: ResourcePanelRepoProps) {
  if (!repoInfo) {
    return (
      <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', padding: '8px 0' }}>
        No repository connected.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{
          fontSize: '13px',
          fontWeight: 600,
          color: 'var(--color-text-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
          minWidth: 0,
        }}>
          {repoInfo.name}
        </span>
        <a
          href={repoInfo.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open repository"
          style={{
            fontSize: '12px',
            color: 'var(--color-accent-primary)',
            textDecoration: 'none',
            flexShrink: 0,
          }}
        >
          ↗
        </a>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{
          fontSize: '11px',
          color: 'var(--color-text-tertiary)',
        }}>
          Branch:
        </span>
        <a
          href={`${repoInfo.url}/tree/${repoInfo.branch}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: '11px',
            color: 'var(--color-accent-primary)',
            textDecoration: 'none',
          }}
        >
          {repoInfo.branch}
        </a>
      </div>

      {touchedFiles.length > 0 && (
        <div>
          <div style={{
            fontSize: '11px',
            fontWeight: 600,
            color: 'var(--color-text-tertiary)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            marginBottom: '6px',
          }}>
            Touched Files
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {touchedFiles.map((file, i) => (
              <TouchedFileRow
                key={`${file.path}-${i}`}
                file={file}
                repoUrl={repoInfo.url}
                branch={repoInfo.branch}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
