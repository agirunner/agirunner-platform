import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { dashboardApi } from '../lib/api.js';

export function ApiKeyManagementPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<'agent' | 'worker' | 'admin'>('agent');
  const [ownerType, setOwnerType] = useState('user');
  const [label, setLabel] = useState('');
  const [expiresAt, setExpiresAt] = useState(() => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString());
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const keysQuery = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => dashboardApi.listApiKeys(),
  });

  async function handleCreate(): Promise<void> {
    try {
      setError(null);
      const created = await dashboardApi.createApiKey({
        scope,
        owner_type: ownerType,
        label: label || undefined,
        expires_at: expiresAt,
      });
      setCreatedKey(created.api_key);
      await queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    } catch (createError) {
      setError(String(createError));
    }
  }

  return (
    <section className="grid">
      <div className="card">
        <h2>API Keys</h2>
        <p className="muted">Create and revoke platform API keys without leaving the dashboard.</p>
        <div className="grid">
          <label htmlFor="api-key-scope">Scope</label>
          <select id="api-key-scope" value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}>
            <option value="agent">agent</option>
            <option value="worker">worker</option>
            <option value="admin">admin</option>
          </select>

          <label htmlFor="api-key-owner-type">Owner type</label>
          <input id="api-key-owner-type" className="input" value={ownerType} onChange={(event) => setOwnerType(event.target.value)} />

          <label htmlFor="api-key-label">Label</label>
          <input id="api-key-label" className="input" value={label} onChange={(event) => setLabel(event.target.value)} />

          <label htmlFor="api-key-expiry">Expires at</label>
          <input id="api-key-expiry" className="input" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="button primary" onClick={() => void handleCreate()}>
            Create API Key
          </button>
        </div>
        {createdKey ? <p className="muted">New key: <code>{createdKey}</code></p> : null}
        {error ? <p style={{ color: '#dc2626' }}>{error}</p> : null}
      </div>

      <div className="card">
        <h3>Issued Keys</h3>
        {keysQuery.isLoading ? <p>Loading keys...</p> : null}
        {keysQuery.error ? <p style={{ color: '#dc2626' }}>Failed to load keys.</p> : null}
        <table className="table">
          <thead>
            <tr>
              <th>Prefix</th>
              <th>Scope</th>
              <th>Owner</th>
              <th>Expires</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {keysQuery.data?.map((apiKey) => (
              <tr key={apiKey.id}>
                <td>{apiKey.key_prefix}</td>
                <td>{apiKey.scope}</td>
                <td>{apiKey.owner_type}</td>
                <td>{new Date(apiKey.expires_at).toLocaleString()}</td>
                <td>{apiKey.is_revoked ? 'revoked' : 'active'}</td>
                <td>
                  <button
                    type="button"
                    className="button"
                    disabled={apiKey.is_revoked}
                    onClick={() => {
                      void dashboardApi.revokeApiKey(apiKey.id).then(() => {
                        queryClient.invalidateQueries({ queryKey: ['api-keys'] });
                      });
                    }}
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
