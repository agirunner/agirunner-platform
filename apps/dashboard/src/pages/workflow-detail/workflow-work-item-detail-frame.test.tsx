import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { WorkItemDetailFrame } from './workflow-work-item-detail-frame.js';

describe('workflow work-item detail frame', () => {
  it('renders the shell header, counters, and status copy', () => {
    const markup = renderToStaticMarkup(
      createElement(
        WorkItemDetailFrame,
        {
          panelTitleId: 'panel-1',
          linkedTaskCount: 3,
          artifactCount: 2,
          isLoading: true,
          hasError: true,
          onClearSelection: () => undefined,
        },
        createElement('div', null, 'Inner content'),
      ),
    );

    expect(markup).toContain('Work Item Detail');
    expect(markup).toContain('Selected work item');
    expect(markup).toContain('3 linked steps');
    expect(markup).toContain('2 artifacts');
    expect(markup).toContain('Loading work item...');
    expect(markup).toContain('Failed to load work item detail.');
    expect(markup).toContain('Inner content');
  });
});
