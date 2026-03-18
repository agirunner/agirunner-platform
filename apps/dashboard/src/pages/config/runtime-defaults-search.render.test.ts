import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { fieldsForSection } from './runtime-defaults.schema.js';
import { RuntimeDefaultsSearchSection } from './runtime-defaults-search.js';
import type { FormValues } from './runtime-defaults.types.js';

describe('runtime defaults search section rendering', () => {
  it('binds field descriptions, recovery guidance, and errors through aria-describedby', () => {
    const markup = renderSearchSection({
      'tools.web_search_provider': 'serper',
      'tools.web_search_base_url': 'https://google.serper.dev/search',
    }, {
      'tools.web_search_api_key_secret_ref':
        'Serper requires a secret reference. Add one or switch the provider to DuckDuckGo.',
    });

    expect(markup).toContain('id="tools.web_search_provider-support"');
    expect(markup).toContain(
      'If Serper credentials are not ready yet, switch the provider to DuckDuckGo or add the secret reference before running web search.',
    );
    expect(markup).toContain('data-testid="clear-web-search-endpoint"');
    expect(markup).toContain(
      'aria-describedby="tools.web_search_api_key_secret_ref-description tools.web_search_api_key_secret_ref-support tools.web_search_api_key_secret_ref-error"',
    );
    expect(markup).toContain(
      'If Serper credentials are not ready yet, switch the provider to DuckDuckGo or add the secret reference before running web search.',
    );
  });

  it('keeps stale-key cleanup guidance attached to the field when returning to DuckDuckGo', () => {
    const markup = renderSearchSection({
      'tools.web_search_provider': 'duckduckgo',
      'tools.web_search_api_key_secret_ref': 'secret:LEGACY_KEY',
    });

    expect(markup).toContain('id="tools.web_search_api_key_secret_ref-support"');
    expect(markup).toContain(
      'This provider ignores API keys. Clear the stale secret reference to avoid confusing operators and runtime recovery.',
    );
    expect(markup).toContain('data-testid="clear-web-search-api-key"');
    expect(markup).toContain(
      'aria-describedby="tools.web_search_api_key_secret_ref-description tools.web_search_api_key_secret_ref-support"',
    );
  });
});

function renderSearchSection(
  values: FormValues,
  errors: Record<string, string> = {},
): string {
  return renderToStaticMarkup(
    createElement(RuntimeDefaultsSearchSection, {
      fields: fieldsForSection('search'),
      values,
      errors,
      onChange: () => undefined,
    }),
  );
}
