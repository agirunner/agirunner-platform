import { describe, expect, it } from 'vitest';

import {
  buildArtifactPermalink,
  describeArtifactPreview,
  formatArtifactPreviewText,
  renderArtifactPreviewMarkup,
  sanitizeHtml,
} from './artifact-preview-support.js';

describe('artifact preview support', () => {
  it('builds a stable artifact permalink', () => {
    expect(buildArtifactPermalink('task-1', 'artifact-1')).toBe('/artifacts/tasks/task-1/artifact-1');
    expect(
      buildArtifactPermalink('task-1', 'artifact-1', {
        returnTo: '/projects/project-1/artifacts?workflow_id=workflow-1',
        returnSource: 'project-artifacts',
      }),
    ).toContain('return_source=project-artifacts');
  });

  it('classifies markdown, html, json, text, and binary artifacts', () => {
    expect(describeArtifactPreview('text/markdown', 'report.md').kind).toBe('markdown');
    expect(describeArtifactPreview('text/html', 'report.html').kind).toBe('html');
    expect(describeArtifactPreview('application/json', 'report.json').kind).toBe('json');
    expect(describeArtifactPreview('text/plain', 'report.txt').kind).toBe('text');
    expect(describeArtifactPreview('application/octet-stream', 'report.bin').kind).toBe('binary');
  });

  it('sanitizes dangerous html while preserving safe links', () => {
    const sanitized = sanitizeHtml(
      '<script>alert(1)</script><p>Hello</p><a href="javascript:alert(2)" onclick="evil()">bad</a><a href="https://example.com">safe</a>',
    );

    expect(sanitized).not.toContain('<script>');
    expect(sanitized).toContain('<p>Hello</p>');
    expect(sanitized).toContain('<a>bad</a>');
    expect(sanitized).toContain('href="https://example.com"');
    expect(sanitized).not.toContain('onclick');
  });

  it('renders markdown into safe preview markup', () => {
    const descriptor = describeArtifactPreview('text/markdown', 'summary.md');
    const markup = renderArtifactPreviewMarkup(
      '# Title\n\n- item\n\n[safe link](https://example.com)\n\n<script>bad()</script>',
      descriptor,
    );

    expect(markup).toContain('<h1>Title</h1>');
    expect(markup).toContain('<ul>');
    expect(markup).toContain('<li>item</li>');
    expect(markup).toContain('href="https://example.com"');
    expect(markup).not.toContain('<script>');
  });

  it('pretty prints json preview text', () => {
    const descriptor = describeArtifactPreview('application/json', 'summary.json');
    expect(formatArtifactPreviewText('{"ok":true}', descriptor)).toContain('\n');
  });
});
