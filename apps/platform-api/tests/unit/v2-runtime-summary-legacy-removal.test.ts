import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const sourceRoot =
  '/home/mark/codex/agirunner-platform/apps/platform-api/src';
const apiRoutesRoot = path.join(sourceRoot, 'api', 'routes');
const workflowRuntimePath = path.join(sourceRoot, 'orchestration', 'workflow-runtime.ts');
const workspaceRunSummaryPath = path.join(sourceRoot, 'services', 'workspace-run-summary.ts');
const workspaceTimelineSummaryLoaderPath = path.join(
  sourceRoot,
  'services',
  'workspace-timeline-summary-loader.ts',
);

const LEGACY_RUNTIME_SUMMARY_MARKERS = [
  'metadata.workflow_runtime',
  'timeline_summary',
  'phase_summary',
  'current_phase',
  'workflow_phase',
  'template_id',
  'template_name',
  'template_version',
] as const;

describe('v2 runtime/summary legacy removal', () => {
  it('keeps the deleted legacy runtime and summary modules out of the active source tree', () => {
    expect(existsSync(workflowRuntimePath)).toBe(false);
    expect(existsSync(workspaceRunSummaryPath)).toBe(false);
    expect(existsSync(workspaceTimelineSummaryLoaderPath)).toBe(true);
  });

  it('does not reintroduce template or phase summary markers in active orchestration, service, or route code', () => {
    const files = [
      ...readTypeScriptFiles(apiRoutesRoot),
      ...readTypeScriptFiles(path.join(sourceRoot, 'orchestration')),
      ...readTypeScriptFiles(path.join(sourceRoot, 'services')),
    ];
    const offenders: Array<{ file: string; marker: string }> = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const marker of LEGACY_RUNTIME_SUMMARY_MARKERS) {
        if (source.includes(marker)) {
          offenders.push({ file, marker });
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

function readTypeScriptFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const fullPath = path.join(directory, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...readTypeScriptFiles(fullPath));
      continue;
    }
    if (fullPath.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}
