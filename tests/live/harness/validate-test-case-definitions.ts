#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

type ScenarioDef = {
  key: string;
  id: string;
  title: string;
  planRef: string;
};

type Canonical = {
  version: string;
  providers: string[];
  scenarios: ScenarioDef[];
};

type TraceabilityState = {
  scenarios: ScenarioDef[];
};

function fail(message: string): never {
  throw new Error(`test-case-definition drift: ${message}`);
}

function parseSingleQuotedArray(source: string, variableName: string): string[] {
  const re = new RegExp(`${variableName}\\s*:\\s*ScenarioName\\[]\\s*=\\s*\\[([\\s\\S]*?)\\];`, 'm');
  const match = source.match(re);
  if (!match) fail(`could not find ${variableName} in tests/live/harness/runner.ts`);
  return Array.from(match[1].matchAll(/'([^']+)'/g), (m) => m[1]);
}

function parseRunScenarioCases(source: string): string[] {
  const switchStart = source.indexOf('async function runScenarioByName(');
  if (switchStart === -1) fail('runScenarioByName function not found in runner.ts');
  const tail = source.slice(switchStart);
  return Array.from(tail.matchAll(/case '([^']+)':/g), (m) => m[1]);
}

function assertUnique(values: string[], label: string): void {
  const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
  if (duplicates.length > 0) {
    fail(`${label} has duplicate entries: ${Array.from(new Set(duplicates)).join(', ')}`);
  }
}

function assertSetEqual(expected: string[], actual: string[], context: string): void {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);

  const missing = expected.filter((v) => !actualSet.has(v));
  const extra = actual.filter((v) => !expectedSet.has(v));

  if (missing.length || extra.length) {
    fail(`${context} mismatch; missing=[${missing.join(', ')}], extra=[${extra.join(', ')}]`);
  }
}

function main(): void {
  const root = process.cwd();
  const canonicalPath = path.join(root, 'tests/reports/test-cases.v1.json');
  const runnerPath = path.join(root, 'tests/live/harness/runner.ts');
  const flowPath = path.join(root, 'tests/live/harness/traceability-flow.ts');
  const statePath = path.join(root, 'tests/reports/traceability.state.json');

  if (!existsSync(canonicalPath)) fail(`missing canonical file ${canonicalPath}`);
  const canonical = JSON.parse(readFileSync(canonicalPath, 'utf8')) as Canonical;

  if (!Array.isArray(canonical.providers) || canonical.providers.length === 0) {
    fail('canonical providers must be non-empty');
  }
  if (!Array.isArray(canonical.scenarios) || canonical.scenarios.length === 0) {
    fail('canonical scenarios must be non-empty');
  }

  const canonicalKeys = canonical.scenarios.map((scenario) => scenario.key);
  const canonicalIds = canonical.scenarios.map((scenario) => scenario.id);
  assertUnique(canonicalKeys, 'canonical scenario keys');
  assertUnique(canonicalIds, 'canonical scenario IDs');

  const runnerSource = readFileSync(runnerPath, 'utf8');
  const allScenarios = parseSingleQuotedArray(runnerSource, 'ALL_SCENARIOS');
  const switchCases = parseRunScenarioCases(runnerSource);

  assertSetEqual(canonicalKeys, allScenarios.filter((name) => canonicalKeys.includes(name)), 'canonical->runner ALL_SCENARIOS');
  assertSetEqual(canonicalKeys, switchCases.filter((name) => canonicalKeys.includes(name)), 'canonical->runner runScenarioByName cases');

  const flowSource = readFileSync(flowPath, 'utf8');
  if (!flowSource.includes('tests/reports/test-cases.v1.json')) {
    fail('traceability-flow.ts must load tests/reports/test-cases.v1.json');
  }

  if (existsSync(statePath)) {
    const state = JSON.parse(readFileSync(statePath, 'utf8')) as TraceabilityState;
    const stateDefs = state.scenarios ?? [];
    const canonicalDigest = canonical.scenarios.map((s) => `${s.key}|${s.id}|${s.title}|${s.planRef}`);
    const stateDigest = stateDefs.map((s) => `${s.key}|${s.id}|${s.title}|${s.planRef}`);
    assertSetEqual(canonicalDigest, stateDigest, 'canonical definitions vs tests/reports/traceability.state.json');
  }

  console.log(`OK: canonical test-case definitions validated (${canonical.scenarios.length} scenarios).`);
}

main();
