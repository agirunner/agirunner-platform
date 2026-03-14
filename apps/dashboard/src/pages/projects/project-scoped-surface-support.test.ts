import { describe, expect, it } from 'vitest';

import { buildProjectScopedSurfaceDefinition } from './project-scoped-surface-support.js';

describe('project scoped surface support', () => {
  it('builds compact knowledge-linked framing for scoped run content', () => {
    const definition = buildProjectScopedSurfaceDefinition('documents');

    expect(definition.title).toBe('Run content');
    expect(definition.breadcrumbLabel).toBe('Run content');
    expect(definition.description).toContain('workflow documents and task artifacts');
  });

  it('builds compact framing for focused artifact evidence review', () => {
    const definition = buildProjectScopedSurfaceDefinition('artifacts');

    expect(definition.title).toBe('Artifact evidence');
    expect(definition.breadcrumbLabel).toBe('Artifact evidence');
    expect(definition.description).toContain('delivery evidence');
  });

  it('builds compact framing for project memory review', () => {
    const definition = buildProjectScopedSurfaceDefinition('memory');

    expect(definition.title).toBe('Project memory');
    expect(definition.breadcrumbLabel).toBe('Project memory');
    expect(definition.description).toContain('same knowledge workspace');
  });
});
