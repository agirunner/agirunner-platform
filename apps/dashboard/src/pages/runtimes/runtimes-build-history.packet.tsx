import type { DashboardCustomizationManifest } from '../../lib/api.js';
import {
  buildRuntimeManifestPackets,
  formatManifestJson,
} from './runtimes-build-history.manifest.js';

export function ActiveRuntimeManifestPacket(props: {
  manifest: DashboardCustomizationManifest;
}): JSX.Element {
  const packets = buildRuntimeManifestPackets(props.manifest);
  const rawManifest = formatManifestJson(props.manifest);

  return (
    <div className="grid gap-4 rounded-xl border border-border/70 bg-muted/10 p-4">
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">Manifest packet</p>
        <p className="text-sm leading-6 text-muted">
          Review the Specialist Agent image inputs and reasoning before making the next rebuild or relink decision.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {packets.map((packet) => (
          <div key={packet.label} className="rounded-xl border border-border/70 bg-card/70 p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
              {packet.label}
            </p>
            <p className={`mt-2 text-sm leading-6 ${packet.label === 'Base image' ? 'font-mono text-xs' : 'font-medium'}`}>
              {packet.value}
            </p>
            <p className="mt-2 text-xs leading-5 text-muted">{packet.detail}</p>
          </div>
        ))}
      </div>
      <details className="rounded-xl border border-border/70 bg-card/70 p-3">
        <summary className="cursor-pointer text-sm font-medium text-foreground">
          Open raw manifest JSON
        </summary>
        <pre className="mt-3 max-h-72 overflow-auto rounded-xl border border-border/70 bg-background/70 p-4 text-xs font-mono">
          {rawManifest}
        </pre>
      </details>
    </div>
  );
}
