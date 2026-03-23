import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { dashboardApi } from '../../lib/api.js';

export function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const [apiKey, setApiKey] = useState('');
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await dashboardApi.login(apiKey, keepSignedIn);
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
        <div className="mb-6 flex flex-col items-center gap-3">
          <img src="/logo.svg" alt="AGI Runner" className="h-20 w-20" />
          <h1 className="text-2xl font-semibold">AGI Runner</h1>
          <p className="text-sm text-muted">Sign in with your API key</p>
        </div>

        <form className="space-y-4" onSubmit={onSubmit}>
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
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={keepSignedIn}
              onChange={(e) => setKeepSignedIn(e.target.checked)}
            />
            <span>Keep me signed in</span>
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50"
          >
            {isSubmitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
