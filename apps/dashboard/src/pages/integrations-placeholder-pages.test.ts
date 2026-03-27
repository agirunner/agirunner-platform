import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readPageSource(relativePath: string) {
  return readFileSync(resolve(import.meta.dirname, relativePath), 'utf8');
}

describe('integration placeholder page copy', () => {
  it('describes webhooks as outbound platform event delivery', () => {
    const source = readPageSource('./webhooks/webhooks-page.tsx');
    expect(source).toContain('Configure outbound webhooks for platform event delivery.');
  });

  it('describes triggers as event-driven work automation', () => {
    const source = readPageSource('./work-item-triggers/work-item-triggers-page.tsx');
    expect(source).toContain('Configure triggers that turn events into work.');
  });

  it('replaces the MCP placeholder with a real management page', () => {
    const source = readPageSource('./mcp/mcp-page.tsx');
    expect(source).toContain('DashboardPageHeader');
    expect(source).not.toContain('ConfigPlaceholderPage');
  });

  it('keeps the webhooks and triggers page titles free of nav-only soon labels', () => {
    const webhooksSource = readPageSource('./webhooks/webhooks-page.tsx');
    const triggersSource = readPageSource('./work-item-triggers/work-item-triggers-page.tsx');
    expect(webhooksSource).toContain('title="Webhooks"');
    expect(triggersSource).toContain('title="Triggers"');
  });

  it('uses the shared next-iteration placeholder copy', () => {
    const source = readPageSource('./config-placeholder/config-placeholder-page.tsx');
    expect(source).toContain('Coming in the next iteration, stay tuned.');
    expect(source).not.toContain('This surface is reserved for the next version of the product.');
  });
});
