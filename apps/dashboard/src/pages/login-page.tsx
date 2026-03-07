import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { dashboardApi } from '../lib/api.js';
import { writeSession } from '../lib/session.js';

type AuthMode = 'password' | 'apikey';

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

export function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const [mode, setMode] = useState<AuthMode>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);

  async function onPasswordSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/auth/login/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        throw new Error('Invalid credentials');
      }

      const result = (await response.json()) as {
        data: { accessToken: string; user: { tenantId: string } };
      };

      writeSession({
        accessToken: result.data.accessToken,
        tenantId: result.data.user.tenantId,
      });

      navigate('/mission-control');
    } catch {
      setError('Invalid email or password');
    } finally {
      setSubmitting(false);
    }
  }

  async function onApiKeySubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await dashboardApi.login(apiKey);
      navigate('/mission-control');
    } catch {
      setError('Invalid API key or server unavailable');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-8 shadow-sm">
        <h1 className="mb-1 text-2xl font-semibold">Agirunner</h1>
        <p className="mb-6 text-sm text-muted">Sign in to access the dashboard</p>

        <div className="mb-6 flex rounded-md border border-border">
          <button
            type="button"
            className={`flex-1 rounded-l-md px-4 py-2 text-sm font-medium transition-colors ${
              mode === 'password'
                ? 'bg-accent text-accent-foreground'
                : 'text-muted hover:text-foreground'
            }`}
            onClick={() => setMode('password')}
          >
            Email & Password
          </button>
          <button
            type="button"
            className={`flex-1 rounded-r-md px-4 py-2 text-sm font-medium transition-colors ${
              mode === 'apikey'
                ? 'bg-accent text-accent-foreground'
                : 'text-muted hover:text-foreground'
            }`}
            onClick={() => setMode('apikey')}
          >
            API Key
          </button>
        </div>

        {mode === 'password' ? (
          <form className="space-y-4" onSubmit={onPasswordSubmit}>
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@localhost"
              />
            </div>
            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50"
            >
              {isSubmitting ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        ) : (
          <form className="space-y-4" onSubmit={onApiKeySubmit}>
            <div>
              <label htmlFor="apikey" className="mb-1 block text-sm font-medium">
                API Key
              </label>
              <input
                id="apikey"
                type="password"
                required
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="ar_admin_..."
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50"
            >
              {isSubmitting ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
