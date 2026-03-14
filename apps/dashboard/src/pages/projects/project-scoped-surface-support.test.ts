import { describe, expect, it } from 'vitest';

import { buildProjectScopedSurfaceDefinition } from './project-scoped-surface-support.js';

describe('project scoped surface support', () => {
  it('builds compact knowledge-linked framing for scoped run content', () => {
    const definition = buildProjectScopedSurfaceDefinition('documents');

    expect(definition.title).toBe('Run content');
    expect(definition.breadcrumbLabel).toBe('Knowledge');
    expect(definition.description).toContain('same run content available from Knowledge');
  });

  it('builds compact framing for focused artifact evidence review', () => {
    const definition = buildProjectScopedSurfaceDefinition('artifacts');

    expect(definition.title).toBe('Artifacts');
    expect(definition.breadcrumbLabel).toBe('Knowledge');
    expect(definition.description).toContain('same artifact evidence available from Knowledge');
  });

  it('builds compact framing for project memory review', () => {
    const definition = buildProjectScopedSurfaceDefinition('memory');

    expect(definition.title).toBe('Memory');
    expect(definition.breadcrumbLabel).toBe('Knowledge');
    expect(definition.description).toContain('same shared memory available from Knowledge');
  });
});
