interface ConnectionIndicatorProps {
  isConnected: boolean;
}

export function ConnectionIndicator({ isConnected }: ConnectionIndicatorProps) {
  if (isConnected) {
    return (
      <div style={{
        width: '6px',
        height: '6px',
        borderRadius: '50%',
        backgroundColor: 'var(--color-status-success)',
      }} />
    );
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 'var(--z-connection)' as any,
      backgroundColor: 'var(--color-status-warning)',
      color: '#000',
      textAlign: 'center',
      padding: '4px',
      fontSize: '11px',
      fontFamily: 'var(--font-family)',
    }}>
      Connection lost. Reconnecting...
    </div>
  );
}
