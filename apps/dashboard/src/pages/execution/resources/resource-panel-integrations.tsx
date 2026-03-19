export interface Integration {
  name: string;
  type: string;
  status: string;
}

export interface ResourcePanelIntegrationsProps {
  integrations?: Integration[];
}

function StatusDot({ status }: { status: string }) {
  const isError = status === 'error';
  const color = isError
    ? 'var(--color-status-error)'
    : 'var(--color-status-success)';

  return (
    <span
      aria-label={status}
      style={{
        display: 'inline-block',
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        backgroundColor: color,
        flexShrink: 0,
      }}
    />
  );
}

function IntegrationRow({ integration }: { integration: Integration }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '6px 0',
      borderBottom: '1px solid var(--color-border-subtle)',
    }}>
      <StatusDot status={integration.status} />
      <span style={{
        fontSize: '12px',
        color: 'var(--color-text-primary)',
        flex: 1,
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {integration.name}
      </span>
      <span style={{
        fontSize: '10px',
        padding: '1px 6px',
        borderRadius: '8px',
        backgroundColor: 'var(--color-bg-secondary)',
        color: 'var(--color-text-secondary)',
        flexShrink: 0,
      }}>
        {integration.type}
      </span>
    </div>
  );
}

export function ResourcePanelIntegrations({ integrations = [] }: ResourcePanelIntegrationsProps) {
  if (integrations.length === 0) {
    return (
      <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', padding: '8px 0' }}>
        No integrations configured.
      </div>
    );
  }

  return (
    <div>
      {integrations.map((integration) => (
        <IntegrationRow key={integration.name} integration={integration} />
      ))}
    </div>
  );
}
