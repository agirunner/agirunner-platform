interface ConnectionIndicatorProps {
  isConnected: boolean;
}

export function ConnectionIndicator({ isConnected }: ConnectionIndicatorProps) {
  if (isConnected) {
    return (
      <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-status-success)]" />
    );
  }

  return (
    <div
      className="fixed top-0 left-0 right-0 bg-[var(--color-status-warning)] text-black text-center py-1 px-2 text-[11px] font-[var(--font-family)]"
      style={{ zIndex: 'var(--z-connection)' as any }}
    >
      Connection lost. Reconnecting...
    </div>
  );
}
