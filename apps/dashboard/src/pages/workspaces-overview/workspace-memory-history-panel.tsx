import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { DiffViewer } from '../../components/diff-viewer/diff-viewer.js';
import { Badge } from '../../components/ui/badge.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { SelectItem } from '../../components/ui/select.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs.js';
import { summarizeMemoryValue } from './workspace-memory-table-support.js';
import type { MemoryEntry } from './workspace-memory-support.js';
import {
  buildMemoryHistoryReview,
  buildMemoryRevisionOptions,
  buildMemoryRevisionId,
  describeMemoryRevisionLabel,
  formatMemoryActor,
  type MemoryActorOption,
  type MemoryKeyOption,
} from './workspace-memory-history-support.js';
import {
  EmptyHistoryState,
  HistoryFilter,
  HistoryFocusPacket,
  HistoryModeTabs,
  PayloadCard,
  RevisionEventBadge,
} from './workspace-memory-history-panel.sections.js';

export function WorkspaceMemoryHistoryPanel(props: {
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
  const [selectedCompareRevisionId, setSelectedCompareRevisionId] = useState('');
  const [mobileView, setMobileView] = useState<'trail' | 'compare'>('trail');

  const review = useMemo(
    () =>
      buildMemoryHistoryReview(
        props.entries,
        props.selectedKey,
        selectedRevisionId,
        selectedCompareRevisionId,
      ),
    [props.entries, props.selectedKey, selectedCompareRevisionId, selectedRevisionId],
  );
  const compareRevisionOptions = useMemo(
    () =>
      buildMemoryRevisionOptions(
        props.entries,
        props.selectedKey,
        review.selectedEntry ? buildMemoryRevisionId(review.selectedEntry) : '',
      ),
    [props.entries, props.selectedKey, review.selectedEntry],
  );

  useEffect(() => {
    const nextRevisionId = review.selectedEntry ? buildMemoryRevisionId(review.selectedEntry) : '';
    if (selectedRevisionId !== nextRevisionId) {
      setSelectedRevisionId(nextRevisionId);
    }
  }, [review.selectedEntry, selectedRevisionId]);

  useEffect(() => {
    if (
      selectedCompareRevisionId &&
      !compareRevisionOptions.some((option) => option.value === selectedCompareRevisionId)
    ) {
      setSelectedCompareRevisionId('');
    }
  }, [compareRevisionOptions, selectedCompareRevisionId]);

  const focusPackets = useMemo(
    () => buildHistoryFocusPackets(review),
    [review],
  );
  const versionTrail = (
    <div className="space-y-4">
      <div className="space-y-2">
        <div>
          <h3 className="text-sm font-medium">Version trail</h3>
          <p className="text-xs text-muted">
            Select a revision to compare it against the version immediately before it or against a
            custom earlier revision.
          </p>
        </div>
        <div className="space-y-2">
          {review.versions.map((entry) => {
            const revisionId = buildMemoryRevisionId(entry);
            const isSelected = review.selectedEntry
              ? revisionId === buildMemoryRevisionId(review.selectedEntry)
              : false;
            return (
              <button
                key={revisionId}
                className={`w-full rounded-2xl border p-3 text-left transition ${
                  isSelected
                    ? 'border-accent/50 bg-accent/5 shadow-sm'
                    : 'border-border/70 bg-card/60 hover:border-accent/30'
                }`}
                type="button"
                onClick={() => {
                  setSelectedRevisionId(revisionId);
                  setMobileView('compare');
                }}
              >
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <RevisionEventBadge eventType={entry.eventType ?? 'updated'} />
                  {entry.stageName ? <Badge variant="secondary">{entry.stageName}</Badge> : null}
                  {entry.taskId ? <Badge variant="outline">Task {entry.taskId}</Badge> : null}
                </div>
                <p className="mt-3 text-sm font-medium">{describeMemoryRevisionLabel(entry)}</p>
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
  );
  const comparisonPanel = (
    <div className="space-y-4">
      <div>
        <div>
          <h3 className="text-sm font-medium">{review.selectedEntry?.key}</h3>
          <p className="text-xs text-muted">
            Inspect the selected revision first, then use the diff and payload tabs to decide
            whether workspace memory needs a follow-up correction.
          </p>
        </div>
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
                ? `${formatMemoryActor(review.previousEntry.actorType, review.previousEntry.actorId)} · comparison`
                : 'No previous version'
            }
            newLabel={`${formatMemoryActor(review.selectedEntry?.actorType, review.selectedEntry?.actorId)} · selected`}
            oldText={review.previousText}
            newText={review.selectedText}
          />
        </TabsContent>
        <TabsContent value="payload" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <PayloadCard
              title="Selected value"
              value={review.selectedEntry?.value}
              helper={
                review.selectedEntry?.updatedAt
                  ? new Date(review.selectedEntry.updatedAt).toLocaleString()
                  : 'Unknown time'
              }
            />
            <PayloadCard
              title="Comparison value"
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
  );

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Work-item Memory History</CardTitle>
            <p className="mt-1 text-sm text-muted">
              Review every version of a scoped memory key, filter by author, and inspect the diff before editing shared workspace memory.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline">{props.entries.length} versions in scope</Badge>
            <Badge variant="secondary">{props.keyOptions.length} keys</Badge>
            <Badge variant="secondary">{props.actorOptions.length} authors</Badge>
          </div>
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
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
          <HistoryFilter
            label="Compare against"
            value={selectedCompareRevisionId}
            onValueChange={setSelectedCompareRevisionId}
            placeholder="Previous revision"
            includeAllOption
          >
            {compareRevisionOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
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
          <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {focusPackets.map((packet) => (
                <HistoryFocusPacket
                  key={packet.label}
                  label={packet.label}
                  value={packet.value}
                  helper={packet.helper}
                  icon={packet.icon}
                />
              ))}
            </div>

            <HistoryModeTabs value={mobileView} onValueChange={setMobileView} />

            <div className="space-y-4 xl:hidden">
              {mobileView === 'trail' ? versionTrail : comparisonPanel}
            </div>
            <div className="hidden gap-6 xl:grid xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              {versionTrail}
              {comparisonPanel}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function buildHistoryFocusPackets(
  review: ReturnType<typeof buildMemoryHistoryReview>,
): Array<{
  label: string;
  value: string;
  helper: string;
  icon: 'history' | 'users';
}> {
  if (!review.selectedEntry) {
    return [];
  }

  const selectedEntry = review.selectedEntry;
  const selectedAuthor = formatMemoryActor(selectedEntry.actorType, selectedEntry.actorId);
  const selectedTimestamp = selectedEntry.updatedAt
    ? new Date(selectedEntry.updatedAt).toLocaleString()
    : 'Unknown time';

  return [
    {
      label: 'Current focus',
      value: selectedEntry.key,
      helper:
        review.previousEntry
          ? 'Compare this revision with the immediately previous value before editing shared memory.'
          : 'Review the first recorded value for this key before deciding whether follow-up memory is needed.',
      icon: 'history',
    },
    {
      label: 'Latest author',
      value: selectedAuthor,
      helper: selectedTimestamp,
      icon: 'users',
    },
    {
      label: 'Version count',
      value: String(review.versions.length),
      helper: 'Versions recorded for the selected memory key.',
      icon: 'history',
    },
    {
      label: 'Comparing against',
      value: review.previousEntry ? describeMemoryRevisionLabel(review.previousEntry) : 'No baseline',
      helper:
        review.previousEntry
          ? 'Use the diff tab first, then confirm whether the latest change should stay in scoped memory.'
          : 'Open the payload tab and confirm the initial memory packet matches the intended workflow handoff.',
      icon: 'history',
    },
  ];
}
