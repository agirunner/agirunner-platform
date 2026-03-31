import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import {
  dashboardApi,
  type DashboardCommunityCatalogConflictAction,
} from '../../../lib/api.js';
import { toast } from '../../../lib/toast.js';
import { Button } from '../../../components/ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog.js';
import { Input } from '../../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select.js';
import {
  filterCommunityCatalogPlaybooks,
  formatCommunityCatalogImportError,
  listCommunityCatalogCategories,
} from './playbook-community-import.support.js';
import { PlaybookCommunityImportCard } from './playbook-community-import-card.js';
import { PlaybookCommunityImportPreview } from './playbook-community-import-preview.js';

export function PlaybookCommunityImportDialog(props: {
  isOpen: boolean;
  onOpenChange(open: boolean): void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [stability, setStability] = useState<'all' | 'stable' | 'experimental'>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [focusedId, setFocusedId] = useState<string>('');
  const [readmeVisible, setReadmeVisible] = useState(false);
  const [defaultConflictResolution, setDefaultConflictResolution] =
    useState<DashboardCommunityCatalogConflictAction>('create_new');
  const [conflictResolutions, setConflictResolutions] = useState<
    Record<string, DashboardCommunityCatalogConflictAction>
  >({});
  const deferredSearch = useDeferredValue(search);
  const selectedIdsKey = useMemo(() => [...selectedIds].sort(), [selectedIds]);

  const playbooksQuery = useQuery({
    queryKey: ['community-catalog-playbooks'],
    queryFn: () => dashboardApi.listCommunityCatalogPlaybooks(),
    enabled: props.isOpen,
    staleTime: 60_000,
  });
  const detailQuery = useQuery({
    queryKey: ['community-catalog-playbook-detail', focusedId],
    queryFn: () => dashboardApi.getCommunityCatalogPlaybookDetail(focusedId),
    enabled: props.isOpen && focusedId.length > 0,
    staleTime: 60_000,
  });
  const previewQuery = useQuery({
    queryKey: ['community-catalog-import-preview', selectedIdsKey],
    queryFn: () => dashboardApi.previewCommunityCatalogImport({ playbook_ids: selectedIdsKey }),
    enabled: props.isOpen && selectedIdsKey.length > 0,
  });
  const importMutation = useMutation({
    mutationFn: () =>
      dashboardApi.importCommunityCatalogPlaybooks({
        playbook_ids: selectedIdsKey,
        default_conflict_resolution: defaultConflictResolution,
        conflict_resolutions: conflictResolutions,
      }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['playbooks'] });
      toast.success(
        result.importedPlaybooks.length === 1
          ? 'Community playbook imported.'
          : `${result.importedPlaybooks.length} community playbooks imported.`,
      );
      resetDialog();
      props.onOpenChange(false);
    },
    onError: (error) => {
      toast.error(formatCommunityCatalogImportError(error));
    },
  });

  const allPlaybooks = playbooksQuery.data ?? [];
  const categories = useMemo(() => listCommunityCatalogCategories(allPlaybooks), [allPlaybooks]);
  const filteredPlaybooks = useMemo(
    () =>
      filterCommunityCatalogPlaybooks(allPlaybooks, deferredSearch, category, stability).sort(
        (left, right) => left.name.localeCompare(right.name),
      ),
    [allPlaybooks, category, deferredSearch, stability],
  );

  useEffect(() => {
    if (!props.isOpen) {
      resetDialog();
      return;
    }
    if (filteredPlaybooks.length === 0) {
      setFocusedId('');
      return;
    }
    if (!filteredPlaybooks.some((playbook) => playbook.id === focusedId)) {
      setFocusedId(filteredPlaybooks[0]?.id ?? '');
      setReadmeVisible(false);
    }
  }, [filteredPlaybooks, focusedId, props.isOpen]);

  function resetDialog(): void {
    setSearch('');
    setCategory('all');
    setStability('all');
    setSelectedIds([]);
    setFocusedId('');
    setReadmeVisible(false);
    setDefaultConflictResolution('create_new');
    setConflictResolutions({});
  }

  function toggleSelected(playbookId: string): void {
    setSelectedIds((current) =>
      current.includes(playbookId)
        ? current.filter((entry) => entry !== playbookId)
        : [...current, playbookId],
    );
  }

  function selectAllFiltered(): void {
    setSelectedIds((current) => Array.from(new Set([...current, ...filteredPlaybooks.map((item) => item.id)])));
  }

  return (
    <Dialog open={props.isOpen} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[88vh] w-[min(92vw,108rem)] max-w-none overflow-hidden p-0">
        <div className="grid h-full max-h-[88vh] grid-rows-[auto_minmax(0,1fr)_auto]">
          <DialogHeader className="border-b border-border/70 px-6 py-5">
            <DialogTitle>Add Community Playbooks</DialogTitle>
            <DialogDescription>
              Search the public catalog, select a subset or the full filtered set, then import local copies into this tenant.
            </DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 gap-0 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
            <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border-b border-border/70 lg:border-b-0 lg:border-r">
              <div className="grid gap-3 px-6 py-5">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_180px]">
                  <label className="grid gap-2 text-sm">
                    <span className="font-medium">Search</span>
                    <Input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search community playbooks"
                    />
                  </label>
                  <label className="grid gap-2 text-sm">
                    <span className="font-medium">Category</span>
                    <Select value={category} onValueChange={setCategory}>
                      <SelectTrigger aria-label="Catalog category">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All categories</SelectItem>
                        {categories.map((entry) => (
                          <SelectItem key={entry} value={entry}>
                            {entry}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="grid gap-2 text-sm">
                    <span className="font-medium">Stability</span>
                    <Select
                      value={stability}
                      onValueChange={(value) => setStability(value as 'all' | 'stable' | 'experimental')}
                    >
                      <SelectTrigger aria-label="Catalog stability">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All stability levels</SelectItem>
                        <SelectItem value="stable">Stable</SelectItem>
                        <SelectItem value="experimental">Experimental</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted">
                    {filteredPlaybooks.length} matching playbooks · {selectedIds.length} selected
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={selectAllFiltered} disabled={filteredPlaybooks.length === 0}>
                      Select all filtered
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setSelectedIds([])} disabled={selectedIds.length === 0}>
                      Clear selection
                    </Button>
                  </div>
                </div>
              </div>

              <div className="min-h-0 overflow-y-auto px-6 pb-6">
                {playbooksQuery.isLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading community catalog…
                  </div>
                ) : playbooksQuery.error ? (
                  <p className="text-sm text-red-600 dark:text-red-400">
                    {formatCommunityCatalogImportError(playbooksQuery.error)}
                  </p>
                ) : filteredPlaybooks.length === 0 ? (
                  <p className="text-sm text-muted">No community playbooks match the current filters.</p>
                ) : (
                  <div className="grid gap-3">
                    {filteredPlaybooks.map((playbook) => {
                      return (
                        <PlaybookCommunityImportCard
                          key={playbook.id}
                          playbook={playbook}
                          isSelected={selectedIds.includes(playbook.id)}
                          isFocused={focusedId === playbook.id}
                          onFocus={() => {
                            setFocusedId(playbook.id);
                            setReadmeVisible(false);
                          }}
                          onToggleSelected={() => toggleSelected(playbook.id)}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="min-h-0 overflow-y-auto px-6 py-5">
              <PlaybookCommunityImportPreview
                highlightedDetail={detailQuery.data ?? null}
                isDetailLoading={detailQuery.isLoading}
                detailError={
                  detailQuery.error ? formatCommunityCatalogImportError(detailQuery.error) : null
                }
                isReadmeVisible={readmeVisible}
                onToggleReadme={() => setReadmeVisible((current) => !current)}
                selectedCount={selectedIds.length}
                preview={previewQuery.data ?? null}
                isPreviewLoading={previewQuery.isLoading}
                previewError={
                  previewQuery.error ? formatCommunityCatalogImportError(previewQuery.error) : null
                }
                defaultConflictResolution={defaultConflictResolution}
                conflictResolutions={conflictResolutions}
                onDefaultConflictResolutionChange={setDefaultConflictResolution}
                onConflictResolutionChange={(conflictKey, value) =>
                  setConflictResolutions((current) => ({ ...current, [conflictKey]: value }))
                }
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 px-6 py-4">
            <p className="text-sm text-muted">
              Imported playbooks become normal local copies. Re-importing later creates new local revisions or overrides based on the conflict actions you choose here.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => props.onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => importMutation.mutate()}
                disabled={selectedIds.length === 0 || importMutation.isPending}
              >
                {importMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Import selected
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
