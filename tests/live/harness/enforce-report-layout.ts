#!/usr/bin/env node
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

function fail(message: string): never {
  throw new Error(`report-layout violation: ${message}`);
}

function main(): void {
  const root = process.cwd();
  const reportsDir = path.join(root, 'tests/reports');
  const entries = readdirSync(reportsDir);

  const required = new Set(['test-cases.v1.json', 'results.v1.json', 'batch-results.v1.json']);

  const optionalCanonicalJson = /^traceability.*\.json$/;

  const forbiddenLegacy = new Set([
    'traceability-matrix.md',
    'traceability-matrix.json',
    'traceability.state.json',
  ]);

  for (const entry of entries) {
    const fullPath = path.join(reportsDir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      fail(`subdirectory is forbidden in tests/reports: ${entry}`);
    }

    if (forbiddenLegacy.has(entry)) {
      fail(`legacy matrix/state file is forbidden: tests/reports/${entry}`);
    }

    if (!entry.endsWith('.json')) {
      fail(`only canonical JSON files are allowed in tests/reports: ${entry}`);
    }

    const isAllowed = required.has(entry) || optionalCanonicalJson.test(entry);
    if (!isAllowed) {
      fail(`non-canonical report file is forbidden: tests/reports/${entry}`);
    }
  }

  for (const file of required) {
    if (!entries.includes(file)) {
      fail(`missing required file: tests/reports/${file}`);
    }
  }

  console.log('OK: report layout is flat and legacy files are absent.');
}

main();
