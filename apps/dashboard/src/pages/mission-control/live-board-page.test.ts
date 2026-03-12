import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './live-board-page.tsx'), 'utf8');
}

describe('live board page source', () => {
  it('does not retain phase-era workflow fields in the live board model', () => {
    const source = readSource();
    expect(source).toContain('isLiveWorkflow');
    expect(source).not.toContain('phases?: Array');
  });

  it('adds search, saved views, stronger invalidation, and workflow-context deep links', () => {
    const source = readSource();
    expect(source).toContain('useSearchParams');
    expect(source).toContain("searchParams.get('q')");
    expect(source).toContain('SavedViews');
    expect(source).toContain("storageKey=\"live-board\"");
    expect(source).toContain("['workflow-stages']");
    expect(source).toContain("['workflow-activations']");
    expect(source).toContain('buildWorkflowDetailPermalink');
    expect(source).toContain('workItemId: item.id');
    expect(source).toContain('gateStageName: gate.stage_name');
  });
});
