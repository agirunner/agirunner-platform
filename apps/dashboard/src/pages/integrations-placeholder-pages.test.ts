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

  it('describes MCP as Model Context Protocol integration management', () => {
    const source = readPageSource('./mcp/mcp-page.tsx');
    expect(source).toContain('Configure Model Context Protocol integrations.');
  });

  it('describes ACP as Agent Communication Protocol integration management', () => {
    const source = readPageSource('./acp/acp-page.tsx');
    expect(source).toContain('Configure Agent Communication Protocol integrations.');
  });

  it('uses the shared next-iteration placeholder copy', () => {
    const source = readPageSource('./config-placeholder/config-placeholder-page.tsx');
    expect(source).toContain('Coming in the next iteration, stay tuned.');
    expect(source).not.toContain('This surface is reserved for the next version of the product.');
  });
});
