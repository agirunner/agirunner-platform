import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Loader2, History, Users } from 'lucide-react';

import { DiffViewer } from '../../components/diff-viewer.js';
import { StructuredRecordView } from '../../components/structured-data.js';
import { Badge } from '../../components/ui/badge.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs.js';
import { summarizeMemoryValue } from './project-memory-table-support.js';
import type { MemoryEntry } from './project-memory-support.js';
import {
  buildMemoryHistoryReview,
  buildMemoryRevisionId,
  formatMemoryActor,
  type MemoryActorOption,
  type MemoryKeyOption,
} from './project-memory-history-support.js';

export function ProjectMemoryHistoryPanel(props: {
  entries: MemoryEntry[];
  isLoading: boolean;
  isScopedSelectionReady: boolean;
  selectedActor: string;
  selectedKey: string;
  actorOptions: MemoryActorOption[];
  keyOptions: MemoryKeyOption[];
  onActorChange(value: string): void;
  onKeyChange(value: string): void;
}): JSX.Element {
  const [selectedRevisionId, setSelectedRevisionId] = useState('');

  const review = useMemo(
    () => buildMemoryHistoryReview(props.entries, props.selectedKey, selectedRevisionId),
    [props.entries, props.selectedKey, selectedRevisionId],
  );

  useEffect(() => {
    const nextRevisionId = review.selectedEntry ? buildMemoryRevisionId(review.selectedEntry) : '';
    if (selectedRevisionId !== nextRevisionId) {
      setSelectedRevisionId(nextRevisionId);
    }
  }, [review.selectedEntry, selectedRevisionId]);

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Work-item Memory History</CardTitle>
            <p className="mt-1 text-sm text-muted">
              Review every version of a scoped memory key, filter by author, and inspect the diff before editing shared project memory.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline">{props.entries.length} versions in scope</Badge>
            <Badge variant="secondary">{props.keyOptions.length} keys</Badge>
            <Badge variant="secondary">{props.actorOptions.length} authors</Badge>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <HistoryFilter
            label="Changed by"
            value={props.selectedActor}
            onValueChange={props.onActorChange}
            placeholder="All authors"
            includeAllOption
          >
            {props.actorOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label} ({option.count})
              </SelectItem>
            ))}
          </HistoryFilter>
          <HistoryFilter
            label="Memory key"
            value={props.selectedKey}
            onValueChange={props.onKeyChange}
            placeholder="Select a memory key"
          >
            {props.keyOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.value} ({option.count})
              </SelectItem>
            ))}
          </HistoryFilter>
        </div>
      </CardHeader>
      <CardContent>
        {props.isLoading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading work-item memory history...
          </div>
        ) : !props.isScopedSelectionReady ? (
          <EmptyHistoryState
            title="Select a workflow work item"
            body="Pick a workflow work item above to inspect who changed scoped memory and how the key evolved over time."
          />
        ) : props.entries.length === 0 ? (
          <EmptyHistoryState
            title="No history matched this scope"
            body="Try a different author or memory key, or wait for the workflow to write scoped memory."
          />
        ) : !review.selectedEntry ? (
          <EmptyHistoryState
            title="Choose a memory key"
            body="Select a key to compare versions and inspect the latest scoped decision packet."
          />
        ) : (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                <HistoryPacket
                  label="Latest author"
                  value={formatMemoryActor(review.selectedEntry.actorType, review.selectedEntry.actorId)}
                  helper={review.selectedEntry.updatedAt ? new Date(review.selectedEntry.updatedAt).toLocaleString() : 'Unknown time'}
                  icon={<Users className="h-4 w-4" />}
                />
                <HistoryPacket
                  label="Version count"
                  value={String(review.versions.length)}
                  helper="Versions recorded for the selected memory key."
                  icon={<History className="h-4 w-4" />}
                />
                <HistoryPacket
                  label="Current event"
                  value={review.selectedEntry.eventType === 'deleted' ? 'Deleted' : 'Updated'}
                  helper={review.selectedEntry.stageName ?? 'No stage context'}
                  icon={<History className="h-4 w-4" />}
                />
              </div>

              <div className="space-y-2">
                <div>
                  <h3 className="text-sm font-medium">Version trail</h3>
                  <p className="text-xs text-muted">
                    Select a revision to compare it against the version immediately before it.
                  </p>
                </div>
                <div className="space-y-2">
                  {review.versions.map((entry) => {
                    const revisionId = buildMemoryRevisionId(entry);
                    const isSelected = revisionId === buildMemoryRevisionId(review.selectedEntry!);
                    return (
                      <button
                        key={revisionId}
                        className={`w-full rounded-2xl border p-3 text-left transition ${
                          isSelected ? 'border-accent/50 bg-accent/5 shadow-sm' : 'border-border/70 bg-card/60 hover:border-accent/30'
                        }`}
                        type="button"
                        onClick={() => setSelectedRevisionId(revisionId)}
                      >
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <Badge variant={entry.eventType === 'deleted' ? 'secondary' : 'outline'}>
                            {entry.eventType === 'deleted' ? 'Deleted' : 'Updated'}
                          </Badge>
                          {entry.stageName ? <Badge variant="secondary">{entry.stageName}</Badge> : null}
                          {entry.taskId ? <Badge variant="outline">Task {entry.taskId}</Badge> : null}
                        </div>
                        <p className="mt-3 text-sm font-medium">
                          {formatMemoryActor(entry.actorType, entry.actorId)}
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          {entry.updatedAt ? new Date(entry.updatedAt).toLocaleString() : 'Unknown time'}
                        </p>
                        <p className="mt-2 text-xs text-muted">{summarizeMemoryValue(entry.value)}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium">{review.selectedEntry.key}</h3>
                <p className="text-xs text-muted">
                  Compare the selected revision with the immediately previous value for this key.
                </p>
              </div>

              <Tabs defaultValue="diff" className="space-y-4">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="diff">Version Diff</TabsTrigger>
                  <TabsTrigger value="payload">Payload</TabsTrigger>
                </TabsList>
                <TabsContent value="diff" className="space-y-4">
                  <DiffViewer
                    oldLabel={
                      review.previousEntry
                        ? `${formatMemoryActor(review.previousEntry.actorType, review.previousEntry.actorId)} · previous`
                        : 'No previous version'
                    }
                    newLabel={`${formatMemoryActor(review.selectedEntry.actorType, review.selectedEntry.actorId)} · selected`}
                    oldText={review.previousText}
                    newText={review.selectedText}
                  />
                </TabsContent>
                <TabsContent value="payload" className="space-y-4">
                  <div className="grid gap-4 lg:grid-cols-2">
                    <PayloadCard
                      title="Selected value"
                      value={review.selectedEntry.value}
                      helper={review.selectedEntry.updatedAt ? new Date(review.selectedEntry.updatedAt).toLocaleString() : 'Unknown time'}
                    />
                    <PayloadCard
                      title="Previous value"
                      value={review.previousEntry?.value}
                      helper={
                        review.previousEntry?.updatedAt
                          ? new Date(review.previousEntry.updatedAt).toLocaleString()
                          : 'No previous version'
                      }
                    />
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function HistoryFilter(props: {
  label: string;
  value: string;
  onValueChange(value: string): void;
  placeholder: string;
  includeAllOption?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
        {props.label}
      </span>
      <Select
        value={props.value || (props.includeAllOption ? '__all__' : undefined)}
        onValueChange={(value) =>
          props.onValueChange(props.includeAllOption && value === '__all__' ? '' : value)
        }
      >
        <SelectTrigger>
          <SelectValue placeholder={props.placeholder} />
        </SelectTrigger>
        <SelectContent>
          {props.includeAllOption ? <SelectItem value="__all__">{props.placeholder}</SelectItem> : null}
          {props.children}
        </SelectContent>
      </Select>
    </label>
  );
}

function HistoryPacket(props: {
  label: string;
  value: string;
  helper: string;
  icon: JSX.Element;
}): JSX.Element {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted">
        {props.icon}
        {props.label}
      </div>
      <p className="mt-3 text-sm font-semibold">{props.value}</p>
      <p className="mt-1 text-xs text-muted">{props.helper}</p>
    </div>
  );
}

function PayloadCard(props: {
  title: string;
  value: unknown;
  helper: string;
}): JSX.Element {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
      <div>
        <p className="text-sm font-medium">{props.title}</p>
        <p className="text-xs text-muted">{props.helper}</p>
      </div>
      <div className="mt-3">
        {props.value === undefined ? (
          <p className="text-sm text-muted">No version available.</p>
        ) : (
          <StructuredRecordView
            data={props.value}
            emptyMessage="No value recorded."
          />
        )}
      </div>
    </div>
  );
}

function EmptyHistoryState(props: {
  title: string;
  body: string;
}): JSX.Element {
  return (
    <div className="flex flex-col items-center py-12 text-center text-muted">
      <History className="mb-3 h-10 w-10" />
      <p className="font-medium">{props.title}</p>
      <p className="mt-1 max-w-md text-sm">{props.body}</p>
    </div>
  );
}
