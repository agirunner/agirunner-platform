import { LogViewer } from '../../components/log-viewer/log-viewer.js';

export function LogsPage(): JSX.Element {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Logs</h1>
        <p className="text-sm text-muted">
          Unified view of all platform, runtime, and container manager logs.
        </p>
      </div>

      <LogViewer />
    </div>
  );
}
