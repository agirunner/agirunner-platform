import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return [
    './user-management-page.tsx',
    './user-management-page.dialogs.tsx',
    './user-management-page.deactivate-dialog.tsx',
    './user-management-page.sections.tsx',
    './user-management-page.support.ts',
  ]
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
}

describe('user management page source', () => {
  it('keeps cookie-backed requests, responsive user cards, and labeled desktop actions', () => {
    const source = readSource();
    expect(source).toContain("credentials: 'include'");
    expect(source).toContain('UserCards');
    expect(source).toContain('hidden lg:block');
    expect(source).toContain('Edit access');
    expect(source).not.toContain('title="Edit user"');
  });

  it('keeps user dialogs scrollable and uses typed destructive confirmation', () => {
    const source = readSource();
    expect(source).toContain('max-h-[calc(100vh-4rem)] max-w-2xl overflow-y-auto');
    expect(source).toContain('max-h-[calc(100vh-4rem)] max-w-xl overflow-y-auto');
    expect(source).toContain('Confirm by typing {props.user.email}');
    expect(source).toContain('UserManagementOverview');
  });

  it('marks the surface as legacy and points operators back to API keys', () => {
    const source = readSource();
    expect(source).toContain('Legacy admin surface');
    expect(source).toContain('API keys are the supported primary access model today.');
    expect(source).toContain('Legacy User Access');
    expect(source).toContain('Add legacy user');
  });
});
