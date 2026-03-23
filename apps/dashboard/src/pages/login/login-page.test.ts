import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './login-page.tsx'), 'utf8');
}

describe('login page source', () => {
  it('adds a default-on keep me signed in control and passes it through the login call', () => {
    const source = readSource();

    expect(source).toContain("const [keepSignedIn, setKeepSignedIn] = useState(true);");
    expect(source).toContain('Keep me signed in');
    expect(source).toContain("type=\"checkbox\"");
    expect(source).toContain('checked={keepSignedIn}');
    expect(source).toContain('onChange={(e) => setKeepSignedIn(e.target.checked)}');
    expect(source).toContain('await dashboardApi.login(apiKey, keepSignedIn);');
  });
});
