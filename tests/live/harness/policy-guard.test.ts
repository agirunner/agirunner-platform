import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const providerHosts = [
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
  'aiplatform.googleapis.com',
];

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...collectTsFiles(full));
      continue;
    }
    if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

test('harness/framework code does not hardcode direct provider endpoints', () => {
  const harnessDir = path.resolve('tests/live/harness');
  const files = collectTsFiles(harnessDir);

  for (const file of files) {
    if (file.endsWith('policy-guard.test.ts')) {
      continue;
    }
    const source = readFileSync(file, 'utf8');
    for (const host of providerHosts) {
      assert.equal(
        source.includes(host),
        false,
        `Provider host ${host} must not appear in harness file ${file}`,
      );
    }
  }
});
