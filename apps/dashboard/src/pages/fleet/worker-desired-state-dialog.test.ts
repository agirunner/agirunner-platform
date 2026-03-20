import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './worker-desired-state-dialog.tsx'), 'utf8');
}

describe('worker desired state dialog source', () => {
  it('exposes structured worker editing fields instead of thin registration only', () => {
    const source = readSource();
    expect(source).toContain('Edit Worker Desired State');
    expect(source).toContain('Pool assignment');
    expect(source).toContain('Pool kind');
    expect(source).toContain('Desired replicas');
    expect(source).toContain('Runtime posture');
    expect(source).toContain('Model pinning');
    expect(source).toContain('Add environment variable');
    expect(source).toContain('Fix the highlighted fields before saving this desired state.');
    expect(source).toContain('Saving updates fleet worker desired state immediately.');
    expect(source).toContain('Remove');
    expect(source).toContain('validateWorkerDesiredState');
    expect(source).toContain('dashboardApi.updateFleetWorker');
    expect(source).toContain('max-h-[90vh] max-w-5xl overflow-y-auto p-0');
  });

  it('uses the shared image reference field for runtime image entry', () => {
    const source = readSource();
    expect(source).toContain('ImageReferenceField');
  });
});
