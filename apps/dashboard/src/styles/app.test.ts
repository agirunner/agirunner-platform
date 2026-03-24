import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './app.css'), 'utf8');
}

describe('dashboard shared styles', () => {
  it('binds dark utilities to the app data-theme attribute instead of system preference', () => {
    const source = readSource();
    expect(source).toContain('@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));');
  });

  it('defines the legacy semantic classes still used by workflow and operator surfaces', () => {
    const source = readSource();
    expect(source).toContain('.card');
    expect(source).toContain('.row');
    expect(source).toContain('.muted');
    expect(source).toContain('.status-badge');
    expect(source).toContain('.button');
    expect(source).toContain('.input');
    expect(source).toContain('.table');
    expect(source).toContain('.workflow-lane-grid');
    expect(source).toContain('.two');
    expect(source).toContain('.workflow-item-card');
    expect(source).toContain('.structured-record');
  });
});
