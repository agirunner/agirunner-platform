import { FormEvent, useState } from 'react';
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
      navigate('/workflows');
    } catch {
      setError('Invalid API key or server unavailable');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: '10vh auto' }} className="card">
      <h1>Agirunner Dashboard</h1>
      <p className="muted">Sign in with an API key to start monitoring workflows.</p>
      <form className="grid" onSubmit={onSubmit}>
        <label>
          API Key
          <input className="input" required value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
        </label>
        {error ? <p style={{ color: '#dc2626' }}>{error}</p> : null}
        <button className="button primary" type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
