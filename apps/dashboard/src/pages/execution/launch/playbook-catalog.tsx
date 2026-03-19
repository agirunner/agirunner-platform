import { Search, Star } from 'lucide-react';

import { Badge } from '../../../components/ui/badge.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card.js';
import { Input } from '../../../components/ui/input.js';

export interface PlaybookItem {
  id: string;
  name: string;
  stageCount: number;
  roleCount: number;
  usageCount?: number;
}

export interface PlaybookCatalogProps {
  playbooks: PlaybookItem[];
  starredIds: string[];
  onToggleStar: (playbookId: string) => void;
  onSelect: (playbookId: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export function filterPlaybooks(playbooks: PlaybookItem[], query: string): PlaybookItem[] {
  if (query === '') return playbooks;
  const lower = query.toLowerCase();
  return playbooks.filter((p) => p.name.toLowerCase().includes(lower));
}

export function partitionByStarred(
  playbooks: PlaybookItem[],
  starredIds: string[],
): { starred: PlaybookItem[]; unstarred: PlaybookItem[] } {
  const starredSet = new Set(starredIds);
  const starred: PlaybookItem[] = [];
  const unstarred: PlaybookItem[] = [];
  for (const playbook of playbooks) {
    if (starredSet.has(playbook.id)) {
      starred.push(playbook);
    } else {
      unstarred.push(playbook);
    }
  }
  return { starred, unstarred };
}

function PlaybookCard({
  playbook,
  isStarred,
  isProminent,
  onToggleStar,
  onSelect,
}: {
  playbook: PlaybookItem;
  isStarred: boolean;
  isProminent: boolean;
  onToggleStar: (id: string) => void;
  onSelect: (id: string) => void;
}): JSX.Element {
  return (
    <Card
      className={`cursor-pointer border-border/70 shadow-sm transition-shadow hover:shadow-md ${isProminent ? 'bg-card' : 'bg-card/80'}`}
      onClick={() => onSelect(playbook.id)}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className={isProminent ? 'text-lg' : 'text-base'}>
            {playbook.name}
          </CardTitle>
          <button
            type="button"
            aria-label={isStarred ? 'Unstar playbook' : 'Star playbook'}
            className="shrink-0 text-muted hover:text-accent-primary transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onToggleStar(playbook.id);
            }}
          >
            {isStarred ? (
              <Star className="h-4 w-4 fill-accent-primary text-accent-primary" />
            ) : (
              <Star className="h-4 w-4" />
            )}
          </button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{playbook.stageCount} stages</Badge>
          <Badge variant="secondary">{playbook.roleCount} roles</Badge>
          {playbook.usageCount !== undefined && (
            <span className="text-xs text-muted">{playbook.usageCount} runs</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function PlaybookCatalog({
  playbooks,
  starredIds,
  onToggleStar,
  onSelect,
  searchQuery,
  onSearchChange,
}: PlaybookCatalogProps): JSX.Element {
  const filtered = filterPlaybooks(playbooks, searchQuery);
  const { starred, unstarred } = partitionByStarred(filtered, starredIds);
  const starredSet = new Set(starredIds);

  return (
    <div className="space-y-6">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted pointer-events-none" />
        <Input
          type="search"
          placeholder="Search playbooks..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9"
        />
      </div>

      {starred.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-medium text-muted uppercase tracking-wide">
            Starred
          </h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {starred.map((playbook) => (
              <PlaybookCard
                key={playbook.id}
                playbook={playbook}
                isStarred={true}
                isProminent={true}
                onToggleStar={onToggleStar}
                onSelect={onSelect}
              />
            ))}
          </div>
        </section>
      )}

      {unstarred.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-medium text-muted uppercase tracking-wide">
            All Playbooks
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {unstarred.map((playbook) => (
              <PlaybookCard
                key={playbook.id}
                playbook={playbook}
                isStarred={starredSet.has(playbook.id)}
                isProminent={false}
                onToggleStar={onToggleStar}
                onSelect={onSelect}
              />
            ))}
          </div>
        </section>
      )}

      {filtered.length === 0 && (
        <p className="text-center text-sm text-muted py-8">
          No playbooks match your search.
        </p>
      )}
    </div>
  );
}
