import { useState, type ReactNode } from 'react';
import { BrainCircuit, PackageSearch } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button } from '../../components/ui/button.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs.js';
import type { ProjectWorkspaceOverview } from './project-detail-support.js';

type KnowledgePanelValue = 'workspace' | 'memory' | 'artifacts';

interface ProjectKnowledgeShellProps {
  projectId: string;
  overview: ProjectWorkspaceOverview;
  workspaceContent: ReactNode;
  memoryContent: ReactNode;
  artifactsContent: ReactNode;
}

const KNOWLEDGE_PANELS: Array<{
  value: KnowledgePanelValue;
  label: string;
  description: string;
  icon: typeof BrainCircuit;
}> = [
  {
    value: 'workspace',
    label: 'Workspace',
    description:
      'Structured config, instructions, resources, documents, and tool policy live together here.',
    icon: BrainCircuit,
  },
  {
    value: 'memory',
    label: 'Memory',
    description: 'Typed shared memory entries that stay close to the rest of the knowledge base.',
    icon: BrainCircuit,
  },
  {
    value: 'artifacts',
    label: 'Artifacts',
    description: 'Inline artifact inspection without another top-level project tab.',
    icon: PackageSearch,
  },
];

export function ProjectKnowledgeShell(props: ProjectKnowledgeShellProps): JSX.Element {
  const [activePanel, setActivePanel] = useState<KnowledgePanelValue>('workspace');
  const activePanelOption =
    KNOWLEDGE_PANELS.find((panel) => panel.value === activePanel) ?? KNOWLEDGE_PANELS[0];
  const ActiveIcon = activePanelOption.icon;

  return (
    <div className="space-y-4">
      <Tabs
        value={activePanel}
        onValueChange={(value) => setActivePanel(value as KnowledgePanelValue)}
      >
        <div className="space-y-4 rounded-xl border border-border/70 bg-background/70 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <div className="space-y-1">
                <h2 className="text-sm font-semibold text-foreground">Knowledge workspace</h2>
                <p className="max-w-3xl text-sm leading-6 text-muted">{props.overview.summary}</p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <ActiveIcon className="h-4 w-4 text-muted" />
                  {activePanelOption.label}
                </div>
                <p className="text-sm leading-6 text-muted">{activePanelOption.description}</p>
              </div>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link to={`/projects/${props.projectId}/content`}>Open documents</Link>
            </Button>
          </div>

          <div className="sm:hidden">
            <Select
              value={activePanel}
              onValueChange={(value) => setActivePanel(value as KnowledgePanelValue)}
            >
              <SelectTrigger aria-label="Select knowledge panel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KNOWLEDGE_PANELS.map((panel) => (
                  <SelectItem key={panel.value} value={panel.value}>
                    {panel.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <TabsList className="hidden h-auto w-full flex-wrap gap-1 rounded-xl bg-border/30 p-1 sm:inline-flex">
            {KNOWLEDGE_PANELS.map((panel) => (
              <TabsTrigger key={panel.value} value={panel.value} className="flex-1">
                {panel.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="workspace">{props.workspaceContent}</TabsContent>
        <TabsContent value="memory">{props.memoryContent}</TabsContent>
        <TabsContent value="artifacts">{props.artifactsContent}</TabsContent>
      </Tabs>
    </div>
  );
}
