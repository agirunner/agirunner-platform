import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './project-scoped-surface-header.tsx'), 'utf8');
}

describe('project scoped surface header source', () => {
  it('keeps project-scoped wrappers visually tied back to Knowledge instead of feeling like separate products', () => {
    const source = readSource();

    expect(source).toContain('to={`/projects/${props.projectId}?tab=knowledge`}');
    expect(source).toContain('Back to Knowledge');
    expect(source).toContain("projectTitle === 'Project'");
    expect(source).toContain('text-sm text-muted');
    expect(source).not.toContain('Project knowledge');
    expect(source).not.toContain('<Badge variant="outline">{projectSlug}</Badge>');
  });
});
