import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './login-page.tsx'), 'utf8');
}

function readDashboardDockerfile() {
  return readFileSync(resolve(import.meta.dirname, '../../../../dashboard/Dockerfile'), 'utf8');
}

function readComposeSource() {
  return readFileSync(resolve(import.meta.dirname, '../../../../../docker-compose.yml'), 'utf8');
}

describe('login page source', () => {
  it('adds a local env api key prefill and passes the keep-signed-in flag through the login call', () => {
    const source = readSource();

    expect(source).toContain("const defaultApiKey = import.meta.env.VITE_DASHBOARD_LOGIN_PREFILL_KEY ?? '';");
    expect(source).toContain('const [apiKey, setApiKey] = useState(defaultApiKey);');
    expect(source).toContain("const [keepSignedIn, setKeepSignedIn] = useState(true);");
    expect(source).toContain('Keep me signed in');
    expect(source).toContain("type=\"checkbox\"");
    expect(source).toContain('checked={keepSignedIn}');
    expect(source).toContain('onChange={(e) => setKeepSignedIn(e.target.checked)}');
    expect(source).toContain('await dashboardApi.login(apiKey, keepSignedIn);');
  });

  it('wires the dashboard build to preload the seeded local admin key from compose config', () => {
    const dockerfile = readDashboardDockerfile();
    const compose = readComposeSource();

    expect(dockerfile).toContain('ARG VITE_DASHBOARD_LOGIN_PREFILL_KEY=');
    expect(dockerfile).toContain('ENV VITE_DASHBOARD_LOGIN_PREFILL_KEY=${VITE_DASHBOARD_LOGIN_PREFILL_KEY}');
    expect(compose).toContain('VITE_DASHBOARD_LOGIN_PREFILL_KEY: ${DEFAULT_ADMIN_API_KEY}');
  });
});
