import { describe, expect, it } from 'vitest';

import { validateIntegrationForm } from './integrations-editor-validation.js';
import { createIntegrationFormState } from './integrations-page.support.js';

describe('integration editor validation', () => {
  it('explains missing required delivery settings', () => {
    const result = validateIntegrationForm(createIntegrationFormState('github_issues'), 'create');

    expect(result.isValid).toBe(false);
    expect(result.fieldErrors).toMatchObject({
      owner: 'Choose a repository owner.',
      repo: 'Choose a repository name.',
      token: 'Enter a GitHub access token or keep the stored value.',
    });
    expect(result.issues).toEqual(
      expect.arrayContaining([
        'Choose a repository owner.',
        'Choose a repository name.',
        'Enter a GitHub access token or keep the stored value.',
      ]),
    );
  });

  it('allows edit flows to keep stored secret values', () => {
    const result = validateIntegrationForm(
      {
        ...createIntegrationFormState('slack'),
        configuredSecrets: { webhook_url: true },
      },
      'edit',
    );

    expect(result.isValid).toBe(true);
    expect(result.fieldErrors).toEqual({});
  });

  it('rejects invalid urls and malformed header rows', () => {
    const result = validateIntegrationForm(
      {
        ...createIntegrationFormState('webhook'),
        config: { url: 'not-a-url' },
        headers: [
          { id: 'header-a', key: 'Authorization', value: '', hasStoredSecret: false },
          { id: 'header-b', key: 'authorization', value: 'Bearer again', hasStoredSecret: false },
          { id: 'header-c', key: '', value: 'value', hasStoredSecret: false },
        ],
      },
      'create',
    );

    expect(result.isValid).toBe(false);
    expect(result.fieldErrors).toMatchObject({
      url: 'Enter a valid http:// or https:// URL.',
    });
    expect(result.headerErrors).toMatchObject({
      'header-a': { key: 'Header names must be unique.', value: 'Add a header value or remove this row.' },
      'header-b': { key: 'Header names must be unique.' },
      'header-c': { key: 'Add a header name or remove this row.' },
    });
  });
});
