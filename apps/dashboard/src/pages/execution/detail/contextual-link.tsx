export type LinkType = 'file' | 'memory' | 'artifact' | 'integration' | 'task' | 'unknown';

export interface ContextualLinkProps {
  text: string;
  type: 'file' | 'memory' | 'artifact' | 'integration' | 'task';
  href?: string;
  onNavigate?: (type: string, id?: string) => void;
}

export function detectLinkType(text: string): 'file' | 'memory' | 'artifact' | 'unknown' {
  if (text.startsWith('memory:')) return 'memory';
  if (text.startsWith('artifact:')) return 'artifact';
  if (text.includes('/')) return 'file';
  return 'unknown';
}

export function ContextualLink({ text, type, href, onNavigate }: ContextualLinkProps) {
  const isExternalType = type === 'file' || type === 'integration';

  if (isExternalType) {
    return (
      <a
        href={href ?? '#'}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          color: 'var(--color-link)',
          fontFamily: type === 'file' ? 'monospace' : 'inherit',
          fontSize: 'inherit',
          textDecoration: 'underline',
        }}
      >
        {text}
      </a>
    );
  }

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (onNavigate) {
      const id = text.includes(':') ? text.split(':')[1] : text;
      onNavigate(type, id);
    }
  };

  return (
    <button
      onClick={handleClick}
      style={{
        color: 'var(--color-link)',
        background: 'none',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        fontSize: 'inherit',
        fontFamily: 'inherit',
        textDecoration: 'underline',
      }}
    >
      {text}
    </button>
  );
}
