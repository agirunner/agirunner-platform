import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './api-key-management-page.tsx'), 'utf8');
}

describe('api key management page source', () => {
  it('uses the design-system admin layout instead of legacy semantic classes', () => {
    const source = readSource();
    expect(source).toContain('Dialog');
    expect(source).toContain('CardTitle');
    expect(source).toContain('Table');
    expect(source).not.toContain('className="card"');
    expect(source).not.toContain('className="table"');
    expect(source).not.toContain('className="button');
  });

  it('keeps create and revoke actions real and explicit', () => {
    const source = readSource();
    expect(source).toContain('createMutation');
    expect(source).toContain('revokeMutation');
    expect(source).toContain('Copy');
    expect(source).toContain('Revoke API Key');
  });

  it('shows create-key expiry validation after submit is attempted instead of disabling the create action', () => {
    const source = readSource();
    expect(source).toContain('const [hasAttemptedCreateSubmit, setHasAttemptedCreateSubmit] = useState(false);');
    expect(source).toContain('Select an expiry date.');
    expect(source).toContain('type="submit" disabled={createMutation.isPending}');
  });
});
