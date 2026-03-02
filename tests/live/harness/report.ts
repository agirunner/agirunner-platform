import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { RunReport } from './types.js';

function renderHumanReport(report: RunReport): string {
  const rows = Object.entries(report.scenarios)
    .map(([name, result]) => {
      return `- ${name}: ${result.status.toUpperCase()} | duration=${result.duration} | cost=${result.cost} | validations=${result.validations} | artifacts=${result.artifacts}`;
    })
    .join('\n');

  return [
    `# Live E2E Report — ${report.runId}`,
    '',
    `Started: ${report.startedAt}`,
    `Finished: ${report.finishedAt}`,
    `Template: ${report.template}`,
    `Provider: ${report.provider}`,
    `Repeat: ${report.repeat}`,
    `Containers leaked: ${report.containers_leaked}`,
    `Temp files leaked: ${report.temp_files_leaked}`,
    `Total cost: ${report.total_cost}`,
    '',
    '## Scenarios',
    rows,
    '',
  ].join('\n');
}

export function saveRunReport(report: RunReport): {
  jsonPath: string;
  mdPath: string;
} {
  const reportDir = path.join(process.cwd(), 'tests/reports/live');
  mkdirSync(reportDir, { recursive: true });
  mkdirSync(path.join(reportDir, 'screenshots'), { recursive: true });

  const stamp = report.runId.replace(/[^a-zA-Z0-9_-]/g, '-');
  const jsonPath = path.join(reportDir, `run-${stamp}.json`);
  const mdPath = path.join(reportDir, `run-${stamp}.md`);

  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  writeFileSync(mdPath, renderHumanReport(report));

  return { jsonPath, mdPath };
}
