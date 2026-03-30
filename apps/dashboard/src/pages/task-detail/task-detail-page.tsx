import { useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

import { LogViewer } from '../../components/log-viewer/log-viewer.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../../components/ui/tabs.js';
import { TaskDetailArtifactsPanel } from './task-detail-artifacts-panel.js';
import { TaskDetailContextSection } from './task-detail-context-section.js';
import { resolveStatus, summarizeId, useTaskDetailQuery } from './task-detail-page.model.js';
import { OutputSection } from './task-detail-page.output.js';
import {
  OperatorBriefingCard,
  TaskMetadataGrid,
} from './task-detail-page.sections.js';

export function TaskDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const taskQuery = useTaskDetailQuery(id);

  if (taskQuery.isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (taskQuery.error || !taskQuery.data) {
    return <div className="p-6 text-red-600">Failed to load task. Please try again later.</div>;
  }

  const task = taskQuery.data;
  const status = resolveStatus(task);

  return (
    <div className="space-y-6 p-6">
      <OperatorBriefingCard task={task} status={status} />
      <TaskMetadataGrid task={task} />

      <Tabs defaultValue="output">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-4">
          <TabsTrigger className="w-full" value="output">
            Output
          </TabsTrigger>
          <TabsTrigger className="w-full" value="context">
            Operator Context
          </TabsTrigger>
          <TabsTrigger className="w-full" value="logs">
            Logs
          </TabsTrigger>
          <TabsTrigger className="w-full" value="artifacts">
            Artifacts
          </TabsTrigger>
        </TabsList>

        <TabsContent value="output">
          <Card>
            <CardHeader>
              <CardTitle>Operator Output Packet</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted">
                Review the rendered output first. Use the raw payload only when you need exact
                serialized data.
              </p>
              <OutputSection output={task.output} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="context">
          <TaskDetailContextSection task={task} status={status} summarizeId={summarizeId} />
        </TabsContent>

        <TabsContent value="logs">
          <Card>
            <CardContent className="pt-6">
              <LogViewer scope={{ taskId: task.id }} compact />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="artifacts">
          <Card>
            <CardHeader>
              <CardTitle>Artifacts</CardTitle>
            </CardHeader>
            <CardContent>
              <TaskDetailArtifactsPanel taskId={task.id} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
