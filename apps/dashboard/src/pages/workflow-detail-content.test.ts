import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(
    resolve(import.meta.dirname, './workflow-detail-content.tsx'),
    'utf8',
  );
}

describe('workflow detail content source', () => {
  it('renders documents and memory through design-system cards and controls', () => {
    const source = readSource();
    expect(source).toContain('CardHeader');
    expect(source).toContain('CardContent');
    expect(source).toContain('CardTitle');
    expect(source).toContain('CardDescription');
    expect(source).toContain('Badge');
    expect(source).toContain('Button');
    expect(source).toContain('Input');
    expect(source).toContain('Textarea');
    expect(source).toContain('DocumentCard');
    expect(source).toContain('SurfaceMessage');
    expect(source).toContain('MemoryDraftPreview');
    expect(source).toContain('Structured preview');
    expect(source).not.toContain('Memory value (JSON)');
  });

  it('does not use the legacy semantic card, badge, or form classes', () => {
    const source = readSource();
    expect(source).not.toContain('className="card"');
    expect(source).not.toContain('className="status-badge"');
    expect(source).not.toContain('className="input"');
    expect(source).not.toContain('className="button"');
    expect(source).not.toContain('className="muted"');
  });
});
