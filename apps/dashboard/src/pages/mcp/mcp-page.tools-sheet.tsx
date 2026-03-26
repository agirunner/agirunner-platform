import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import type { DashboardRemoteMcpServerRecord } from '../../lib/api.js';
import { summarizeDiscoveredToolNames } from './mcp-page.support.js';

export function McpPageToolsSheet(props: {
  server: DashboardRemoteMcpServerRecord | null;
  onOpenChange(open: boolean): void;
}) {
  const toolNames = summarizeDiscoveredToolNames(props.server?.discovered_tools_snapshot ?? []);

  return (
    <Dialog
      open={props.server !== null}
      onOpenChange={(open) => props.onOpenChange(open)}
    >
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Discovered tools</DialogTitle>
          <DialogDescription>
            Inspect the last verified tool snapshot for this remote MCP server.
          </DialogDescription>
        </DialogHeader>
        {props.server ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-border/70 bg-muted/10 px-4 py-3 text-sm">
              <p className="font-medium text-foreground">{props.server.name}</p>
              <p className="mt-1 text-muted">{props.server.endpoint_url}</p>
              <p className="mt-2 text-muted">
                {toolNames.length > 0
                  ? `${toolNames.length} tool${toolNames.length === 1 ? '' : 's'} discovered during verification.`
                  : 'No tools were captured in the last verification snapshot.'}
              </p>
            </div>
            <div className="space-y-3">
              {props.server.discovered_tools_snapshot.map((tool, index) => (
                <div
                  key={readToolKey(tool, index)}
                  className="rounded-lg border border-border/70 bg-surface px-4 py-3"
                >
                  <p className="font-medium text-foreground">
                    {readString(tool.original_name) ?? readString(tool.name) ?? 'Unnamed tool'}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    {readString(tool.description) ?? 'No description was returned.'}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function readToolKey(tool: Record<string, unknown>, fallbackIndex: number): string {
  return readString(tool.original_name) ?? readString(tool.name) ?? `tool-${fallbackIndex}`;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
