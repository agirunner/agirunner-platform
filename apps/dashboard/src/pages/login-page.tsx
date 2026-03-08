import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { dashboardApi } from '../lib/api.js';

export function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
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
        <p className="mb-6 text-sm text-muted">Sign in with your API key</p>

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
