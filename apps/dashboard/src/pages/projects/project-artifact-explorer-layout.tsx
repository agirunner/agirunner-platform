import { useEffect, useState } from 'react';

import { Badge } from '../../components/ui/badge.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs.js';

export function ProjectArtifactExplorerAdaptiveLayout(props: {
  artifactCount: number;
  selectedArtifactName: string | null;
  list: JSX.Element;
  inspector: JSX.Element;
}): JSX.Element {
  const [mobileView, setMobileView] = useState<'browse' | 'inspect'>('browse');

  useEffect(() => {
    if (props.selectedArtifactName) {
      setMobileView('inspect');
    }
  }, [props.selectedArtifactName]);

  return (
    <>
      <div className="space-y-4 xl:hidden">
        <div className="rounded-2xl bg-muted/10 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm font-medium">Review mode</p>
              <p className="text-sm text-muted">
                {props.selectedArtifactName
                  ? `Inspecting ${props.selectedArtifactName}. Switch back to the list to compare another artifact.`
                  : 'Browse artifacts first, then switch to inspection for preview, metadata, and linked context.'}
              </p>
            </div>
            <Badge variant="secondary">{props.artifactCount} visible</Badge>
          </div>
        </div>

        <Tabs
          className="space-y-4"
          value={mobileView}
          onValueChange={(value) => setMobileView(value as 'browse' | 'inspect')}
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="browse">Artifact list</TabsTrigger>
            <TabsTrigger value="inspect">Inspect</TabsTrigger>
          </TabsList>
          <TabsContent value="browse" className="space-y-4">
            {props.list}
          </TabsContent>
          <TabsContent value="inspect" className="space-y-4">
            {props.inspector}
          </TabsContent>
        </Tabs>
      </div>

      <div className="hidden gap-6 xl:grid xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.95fr)]">
        {props.list}
        {props.inspector}
      </div>
    </>
  );
}
