import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import type { DashboardRemoteMcpServerRecord } from '../../lib/api.js';
import {
  formatDiscoveredCapabilitySummary,
  summarizeDiscoveredToolNames,
} from './mcp-page.support.js';

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
          <DialogTitle>Discovered capabilities</DialogTitle>
          <DialogDescription>
            Inspect the last verified tools, resources, and prompts for this remote MCP server.
          </DialogDescription>
        </DialogHeader>
        {props.server ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-border/70 bg-muted/10 px-4 py-3 text-sm">
              <p className="font-medium text-foreground">{props.server.name}</p>
              <p className="mt-1 text-muted">{props.server.endpoint_url}</p>
              <p className="mt-2 text-muted">
                {formatDiscoveredCapabilitySummary(props.server)} discovered during verification.
              </p>
            </div>
            <CapabilitySection
              title="Tools"
              emptyMessage="No tools were captured in the last verification snapshot."
              items={props.server.discovered_tools_snapshot}
              getKey={readToolKey}
              getTitle={(tool) => readString(tool.original_name) ?? readString(tool.name) ?? 'Unnamed tool'}
              getDescription={(tool) => readString(tool.description) ?? 'No description was returned.'}
            />
            <CapabilitySection
              title="Resources"
              emptyMessage="No resources were captured in the last verification snapshot."
              items={props.server.discovered_resources_snapshot ?? []}
              getKey={(resource, index) => readString(resource.uri) ?? `resource-${index}`}
              getTitle={(resource) => readString(resource.name) ?? readString(resource.uri) ?? 'Unnamed resource'}
              getDescription={(resource) => readString(resource.description) ?? readString(resource.mimeType) ?? 'No description was returned.'}
            />
            <CapabilitySection
              title="Prompts"
              emptyMessage="No prompts were captured in the last verification snapshot."
              items={props.server.discovered_prompts_snapshot ?? []}
              getKey={(prompt, index) => readString(prompt.name) ?? `prompt-${index}`}
              getTitle={(prompt) => readString(prompt.name) ?? 'Unnamed prompt'}
              getDescription={(prompt) => readString(prompt.description) ?? 'No description was returned.'}
            />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function readToolKey(tool: Record<string, unknown>, fallbackIndex: number): string {
  return readString(tool.original_name) ?? readString(tool.name) ?? `tool-${fallbackIndex}`;
}

function CapabilitySection(props: {
  title: string;
  emptyMessage: string;
  items: Record<string, unknown>[];
  getKey(item: Record<string, unknown>, index: number): string;
  getTitle(item: Record<string, unknown>): string;
  getDescription(item: Record<string, unknown>): string;
}) {
  return (
    <section className="space-y-3">
      <p className="text-sm font-medium text-foreground">{props.title}</p>
      {props.items.length === 0 ? (
        <div className="rounded-lg border border-border/70 bg-surface px-4 py-3 text-sm text-muted">
          {props.emptyMessage}
        </div>
      ) : (
        props.items.map((item, index) => (
          <div
            key={props.getKey(item, index)}
            className="rounded-lg border border-border/70 bg-surface px-4 py-3"
          >
            <p className="font-medium text-foreground">{props.getTitle(item)}</p>
            <p className="mt-1 text-sm text-muted">{props.getDescription(item)}</p>
          </div>
        ))
      )}
    </section>
  );
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
