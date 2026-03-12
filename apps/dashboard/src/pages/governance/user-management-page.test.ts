import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './user-management-page.tsx'), 'utf8');
}

describe('user management page source', () => {
  it('keeps cookie-backed requests and responsive user cards', () => {
    const source = readSource();
    expect(source).toContain("credentials: 'include'");
    expect(source).toContain('UserCards');
    expect(source).toContain('hidden lg:block');
  });

  it('keeps user dialogs scrollable for smaller screens', () => {
    const source = readSource();
    expect(source).toContain('max-h-[80vh] max-w-lg overflow-y-auto');
    expect(source).toContain('max-h-[75vh] max-w-lg overflow-y-auto');
    expect(source).toContain('max-h-[70vh] max-w-lg overflow-y-auto');
  });
});
