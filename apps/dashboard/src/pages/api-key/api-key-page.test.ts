import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return [
    './api-key-page.tsx',
    './api-key-page.dialogs.tsx',
    './api-key-page.sections.tsx',
    './api-key-page.support.ts',
  ]
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
}

describe('governance api key page source', () => {
  it('keeps lifecycle summary cards, mobile cards, and hoverable timestamps for scanability', () => {
    const source = readSource();
    expect(source).toContain('Active keys');
    expect(source).toContain('Expiring soon');
    expect(source).toContain('grid gap-3 lg:hidden');
    expect(source).toContain('hidden lg:block');
    expect(source).toContain('title={formatAbsoluteTimestamp(key.last_used_at)}');
    expect(source).toContain('title={formatAbsoluteTimestamp(key.expires_at)}');
  });

  it('requires typed confirmation before revoke and preserves the create-key review flow', () => {
    const source = readSource();
    expect(source).toContain('Confirm by typing {props.record.key_prefix}');
    expect(source).toContain('Copy the new API key now');
    expect(source).toContain('Copy key');
    expect(source).toContain('Leaving this dialog removes the only visible copy of the secret');
    expect(source).toContain('Revoke API key');
  });

  it('separates operator-managed keys from system keys and keeps system keys read-only', () => {
    const source = readSource();
    expect(source).toContain('Admin / Service Keys');
    expect(source).toContain('System Keys');
    expect(source).toContain('Agentic Runtime');
    expect(source).toContain('Task Execution');
    expect(source).toContain('created and deleted automatically with runtime lifecycle');
    expect(source).not.toContain('<th className="h-10 px-4 text-left font-medium text-muted">Owner</th>');
    expect(source).toContain('<colgroup>');
    expect(source).not.toContain('<Badge variant={scopeVariant(props.scope)}>');
    expect(source).not.toContain('badgeVariant={scopeVariant(props.record.scope)}');
  });

  it('limits operator key creation to admin and service scopes with a no-expiry option', () => {
    const source = readSource();
    expect(source).toContain('Admin and Service keys are unrestricted and grant full platform control');
    expect(source).toContain('<SelectItem value="service">Service</SelectItem>');
    expect(source).toContain('No expiry');
    expect(source).toContain('expires_at: hasNoExpiry ? undefined : new Date(expiryDate).toISOString()');
    expect(source).not.toContain('<SelectItem value="agent">Agent</SelectItem>');
    expect(source).not.toContain('<SelectItem value="worker">Worker</SelectItem>');
    expect(source).toContain('Admin / Service scope');
  });
});
