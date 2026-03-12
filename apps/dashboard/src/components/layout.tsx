import { useEffect, useMemo, useRef, useState } from 'react';
import type { ElementType, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  Box,
  ChevronRight,
  Clipboard,
  Cog,
  Container,
  Database,
  DollarSign,
  FileText,
  FolderOpen,
  Gauge,
  HardDrive,
  Key,
  LayoutDashboard,
  Link2,
  LogOut,
  Menu,
  Moon,
  ScrollText,
  Search,
  Server,
  Settings2,
  Shield,
  Sparkles,
  Sun,
  Timer,
  Users,
  Webhook,
  Workflow,
  Wrench,
  X,
  Zap,
} from 'lucide-react';

import { dashboardApi, type DashboardSearchResult } from '../lib/api.js';
import { readSession, clearSession } from '../lib/session.js';
import { cn } from '../lib/utils.js';
import { readTheme } from '../app/theme.js';
import {
  buildCommandPaletteSearchItems,
  COMMAND_PALETTE_DEBOUNCE_MS,
  describeCommandPaletteState,
  filterCommandPaletteQuickLinks,
  moveCommandPaletteSelection,
  shouldRunCommandPaletteSearch,
  type CommandPaletteItem,
  type CommandPaletteStatus,
} from './layout-search.js';

interface LayoutProps {
  onToggleTheme: () => void;
}

interface NavSection {
  label: string;
  icon: ElementType;
  items: Array<{ label: string; href: string; icon: ElementType }>;
}

const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Mission Control',
    icon: Gauge,
    items: [
      { label: 'Live Board', href: '/mission-control', icon: LayoutDashboard },
      { label: 'Action Queue', href: '/mission-control/alerts', icon: Bell },
      { label: 'Cost Dashboard', href: '/mission-control/costs', icon: DollarSign },
      { label: 'Logs', href: '/logs', icon: ScrollText },
    ],
  },
  {
    label: 'Work',
    icon: Workflow,
    items: [
      { label: 'Workflows', href: '/work/workflows', icon: Workflow },
      { label: 'Tasks', href: '/work/tasks', icon: Clipboard },
      { label: 'Approval Queue', href: '/work/approvals', icon: Bell },
    ],
  },
  {
    label: 'Projects',
    icon: FolderOpen,
    items: [
      { label: 'All Projects', href: '/projects', icon: FolderOpen },
      { label: 'Memory Browser', href: '/projects/memory', icon: Database },
      { label: 'Content Browser', href: '/projects/content', icon: FileText },
    ],
  },
  {
    label: 'Configuration',
    icon: Cog,
    items: [
      { label: 'Playbooks', href: '/config/playbooks', icon: Workflow },
      { label: 'Role Definitions', href: '/config/roles', icon: Users },
      { label: 'Platform Instructions', href: '/config/instructions', icon: ScrollText },
      { label: 'LLM Providers', href: '/config/llm', icon: Cog },
      { label: 'Runtimes', href: '/config/runtimes', icon: Server },
      { label: 'Integrations', href: '/config/integrations', icon: Link2 },
      { label: 'Tools', href: '/config/tools', icon: Wrench },
      { label: 'Webhooks', href: '/config/webhooks', icon: Webhook },
      { label: 'Trigger Overview', href: '/config/triggers', icon: Zap },
      { label: 'AI Assistant', href: '/config/assistant', icon: Sparkles },
    ],
  },
  {
    label: 'Fleet',
    icon: Server,
    items: [
      { label: 'Workers', href: '/fleet/workers', icon: Server },
      { label: 'Agents', href: '/fleet/agents', icon: Users },
      { label: 'Docker', href: '/fleet/docker', icon: Container },
      { label: 'Warm Pools', href: '/fleet/warm-pools', icon: HardDrive },
    ],
  },
  {
    label: 'Governance',
    icon: Shield,
    items: [
      { label: 'Settings', href: '/governance/settings', icon: Settings2 },
      { label: 'Retention Policy', href: '/governance/retention', icon: Timer },
      { label: 'API Keys', href: '/governance/api-keys', icon: Key },
      { label: 'Orchestrator Grants', href: '/governance/grants', icon: Link2 },
      { label: 'User Management', href: '/governance/users', icon: Users },
    ],
  },
];

const COMMAND_PALETTE_QUICK_LINKS: CommandPaletteItem[] = NAV_SECTIONS.flatMap((section) =>
  section.items.map((item) => ({
    id: `nav:${item.href}`,
    href: item.href,
    label: item.label,
    meta: section.label,
    kind: 'navigation',
  })),
);

export function DashboardLayout({ onToggleTheme }: LayoutProps): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const session = readSession();

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<DashboardSearchResult[]>([]);
  const [searchStatus, setSearchStatus] = useState<CommandPaletteStatus>('idle');
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activePaletteIndex, setActivePaletteIndex] = useState(-1);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const paletteItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const searchRequestRef = useRef(0);
  const isDark = readTheme() === 'dark';

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  const currentSection = useMemo(() => {
    const path = location.pathname;
    for (const section of NAV_SECTIONS) {
      if (section.items.some((item) => path.startsWith(item.href))) {
        return section.label;
      }
    }
    return NAV_SECTIONS[0].label;
  }, [location.pathname]);

  const shouldSearchWorkspace = shouldRunCommandPaletteSearch(searchQuery);
  const searchItems = useMemo(
    () => buildCommandPaletteSearchItems(searchResults),
    [searchResults],
  );
  const quickLinks = useMemo(
    () => filterCommandPaletteQuickLinks(COMMAND_PALETTE_QUICK_LINKS, searchQuery),
    [searchQuery],
  );
  const visiblePaletteItems = shouldSearchWorkspace ? searchItems : quickLinks;
  const paletteState = useMemo(
    () =>
      describeCommandPaletteState({
        query: searchQuery,
        status: searchStatus,
        visibleItemCount: visiblePaletteItems.length,
        errorMessage: searchError,
      }),
    [searchError, searchQuery, searchStatus, visiblePaletteItems.length],
  );

  function openSearchPalette(): void {
    setSearchOpen(true);
    setIsMobileMenuOpen(false);
  }

  function closeSearchPalette(): void {
    searchRequestRef.current += 1;
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    setSearchStatus('idle');
    setSearchError(null);
    setActivePaletteIndex(-1);
  }

  function navigateToPaletteItem(item: CommandPaletteItem): void {
    navigate(item.href);
    closeSearchPalette();
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        openSearchPalette();
      }
      if (event.key === 'Escape' && searchOpen) {
        closeSearchPalette();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [searchOpen]);

  useEffect(() => {
    if (!searchOpen) {
      return;
    }
    searchInputRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    paletteItemRefs.current = [];
    setActivePaletteIndex(visiblePaletteItems.length > 0 ? 0 : -1);
  }, [searchOpen, visiblePaletteItems]);

  useEffect(() => {
    if (activePaletteIndex < 0) {
      return;
    }
    paletteItemRefs.current[activePaletteIndex]?.scrollIntoView({
      block: 'nearest',
    });
  }, [activePaletteIndex]);

  useEffect(() => {
    if (!searchOpen) {
      return;
    }

    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;

    if (!shouldSearchWorkspace) {
      setSearchResults([]);
      setSearchStatus('idle');
      setSearchError(null);
      return;
    }

    setSearchStatus('loading');
    setSearchError(null);
    setSearchResults([]);

    const handle = window.setTimeout(() => {
      void dashboardApi
        .search(searchQuery.trim())
        .then((results) => {
          if (searchRequestRef.current !== requestId) {
            return;
          }
          setSearchResults(results);
          setSearchStatus('ready');
        })
        .catch((error: unknown) => {
          if (searchRequestRef.current !== requestId) {
            return;
          }
          setSearchResults([]);
          setSearchStatus('error');
          setSearchError(
            error instanceof Error
              ? error.message
              : 'The dashboard could not load search results right now.',
          );
        });
    }, COMMAND_PALETTE_DEBOUNCE_MS);

    return () => window.clearTimeout(handle);
  }, [searchOpen, searchQuery, shouldSearchWorkspace]);

  function handlePaletteInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActivePaletteIndex((current) =>
        moveCommandPaletteSelection(current, visiblePaletteItems.length, 'next'),
      );
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActivePaletteIndex((current) =>
        moveCommandPaletteSelection(current, visiblePaletteItems.length, 'previous'),
      );
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      setActivePaletteIndex(
        moveCommandPaletteSelection(activePaletteIndex, visiblePaletteItems.length, 'first'),
      );
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      setActivePaletteIndex(
        moveCommandPaletteSelection(activePaletteIndex, visiblePaletteItems.length, 'last'),
      );
      return;
    }

    if (event.key === 'Enter' && activePaletteIndex >= 0) {
      event.preventDefault();
      const activeItem = visiblePaletteItems[activePaletteIndex];
      if (activeItem) {
        navigateToPaletteItem(activeItem);
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      closeSearchPalette();
    }
  }

  const sidebarContent = (
    <>
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-lg font-semibold">Agirunner</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onToggleTheme}
            className="rounded-md p-1.5 text-muted hover:bg-border/50"
            aria-label="Toggle theme"
          >
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen(false)}
            className="rounded-md p-1.5 text-muted hover:bg-border/50 lg:hidden"
            aria-label="Close menu"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="px-3 py-2">
        <button
          type="button"
          onClick={openSearchPalette}
          className="flex w-full items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:bg-border/30"
        >
          <Search size={14} />
          <span>Search...</span>
          <kbd className="ml-auto hidden rounded border border-border px-1.5 py-0.5 text-xs sm:inline">
            {'\u2318'}K
          </kbd>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-1">
        {NAV_SECTIONS.map((section) => (
          <NavSectionGroup
            key={section.label}
            section={section}
            isActive={currentSection === section.label}
          />
        ))}
      </nav>

      <div className="border-t border-border p-3">
        <div className="mb-2 text-xs text-muted">
          {session?.tenantId ? `Tenant ${session.tenantId.slice(0, 8)}...` : ''}
        </div>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted hover:bg-border/30"
          onClick={() => {
            void dashboardApi.logout().finally(() => {
              clearSession();
              queryClient.clear();
              navigate('/login');
            });
          }}
        >
          <LogOut size={14} />
          Logout
        </button>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen">
      {/* Mobile header bar */}
      <div className="fixed left-0 right-0 top-0 z-30 flex items-center justify-between border-b border-border bg-surface px-4 py-2 lg:hidden">
        <button
          type="button"
          onClick={() => setIsMobileMenuOpen(true)}
          className="rounded-md p-1.5 text-muted hover:bg-border/50"
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
        <span className="text-sm font-semibold">Agirunner</span>
        <button
          type="button"
          onClick={openSearchPalette}
          className="rounded-md p-1.5 text-muted hover:bg-border/50"
          aria-label="Search"
        >
          <Search size={18} />
        </button>
      </div>

      {/* Mobile sidebar overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-border bg-surface transition-transform duration-200 lg:static lg:translate-x-0',
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {sidebarContent}
      </aside>

      <main className="flex-1 overflow-y-auto bg-background pt-12 lg:pt-0">
        <div className="px-4 py-4 sm:px-6 lg:px-8">
          <Outlet />
        </div>
      </main>

      {searchOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-16 sm:pt-24"
          onClick={closeSearchPalette}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-border/80 bg-surface/95 p-4 shadow-xl backdrop-blur"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-3">
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      Search the workspace
                    </p>
                    <p className="text-xs text-muted">
                      Workflows, tasks, projects, playbooks, workers, and agents.
                    </p>
                  </div>
                  <kbd className="rounded border border-border px-1.5 py-0.5 text-xs text-muted">
                    Esc
                  </kbd>
                </div>
              </div>

              <div className="rounded-xl border border-border/80 bg-background/70 px-3 py-2">
                <div className="flex items-center gap-2">
                  <Search size={16} className="text-muted" />
                  <input
                    ref={searchInputRef}
                    className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
                    placeholder="Type to search or jump to a quick link"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    onKeyDown={handlePaletteInputKeyDown}
                    role="combobox"
                    aria-expanded={searchOpen}
                    aria-controls="dashboard-command-palette-results"
                    aria-activedescendant={
                      activePaletteIndex >= 0
                        ? `dashboard-command-palette-item-${activePaletteIndex}`
                        : undefined
                    }
                    aria-label="Search the workspace"
                  />
                  {searchStatus === 'loading' ? (
                    <span className="text-xs text-muted">Searching…</span>
                  ) : null}
                </div>
              </div>

              <div
                className={cn(
                  'rounded-xl border px-3 py-3 text-sm',
                  searchStatus === 'error'
                    ? 'border-red-300/80 bg-red-50/80 text-red-900 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-100'
                    : 'border-border/70 bg-muted/10 text-muted',
                )}
              >
                <p className="font-medium text-foreground">{paletteState.title}</p>
                <p className="mt-1 text-xs leading-5">{paletteState.detail}</p>
              </div>

              {visiblePaletteItems.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3 px-1">
                    <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted">
                      {shouldSearchWorkspace ? 'Results' : 'Quick links'}
                    </p>
                    <p className="text-xs text-muted">
                      {shouldSearchWorkspace
                        ? `${visiblePaletteItems.length} matches`
                        : `${visiblePaletteItems.length} destinations`}
                    </p>
                  </div>
                  <ul
                    id="dashboard-command-palette-results"
                    role="listbox"
                    className="max-h-72 space-y-1 overflow-y-auto"
                  >
                    {visiblePaletteItems.map((item, index) => (
                      <li key={item.id}>
                        <button
                          id={`dashboard-command-palette-item-${index}`}
                          ref={(element) => {
                            paletteItemRefs.current[index] = element;
                          }}
                          type="button"
                          role="option"
                          aria-selected={index === activePaletteIndex}
                          className={cn(
                            'flex w-full items-start justify-between gap-3 rounded-xl px-3 py-3 text-left text-sm transition-colors',
                            index === activePaletteIndex
                              ? 'bg-accent/10 text-foreground'
                              : 'hover:bg-border/30',
                          )}
                          onMouseEnter={() => setActivePaletteIndex(index)}
                          onClick={() => navigateToPaletteItem(item)}
                        >
                          <div className="min-w-0">
                            <p className="font-medium text-foreground">{item.label}</p>
                            <p className="truncate text-xs text-muted">{item.meta}</p>
                          </div>
                          <span className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted">
                            {item.kind}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {!shouldSearchWorkspace && visiblePaletteItems.length === 0 ? (
                <p className="px-1 text-xs text-muted">
                  No quick links match that text yet. Keep typing to search the full workspace.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NavSectionGroup({
  section,
  isActive,
}: {
  section: NavSection;
  isActive: boolean;
}): JSX.Element {
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (isActive) {
      setExpanded(true);
    }
  }, [isActive]);
  const Icon = section.icon;

  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium',
          isActive ? 'text-accent' : 'text-foreground hover:bg-border/30',
        )}
      >
        <Icon size={15} />
        <span className="flex-1 text-left">{section.label}</span>
        <ChevronRight
          size={14}
          className={cn('transition-transform', expanded && 'rotate-90')}
        />
      </button>
      {expanded && (
        <div className="ml-4 mt-0.5 space-y-0.5 border-l border-border pl-2">
          {section.items.map((item) => (
            <NavLink
              key={item.href}
              to={item.href}
              end
              className={({ isActive: active }) =>
                cn(
                  'flex items-center gap-2 rounded-md px-3 py-1 text-sm',
                  active
                    ? 'bg-accent/10 font-medium text-accent'
                    : 'text-muted-foreground hover:bg-border/30 hover:text-foreground',
                )
              }
            >
              <item.icon size={13} />
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export function buildBreadcrumbs(pathname: string): Array<{ label: string; href?: string }> {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return [{ label: 'Home' }];

  const crumbs: Array<{ label: string; href?: string }> = [];
  let currentPath = '';

  for (let i = 0; i < segments.length; i++) {
    currentPath += `/${segments[i]}`;
    crumbs.push({
      label: segments[i].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      href: i === segments.length - 1 ? undefined : currentPath,
    });
  }

  return crumbs;
}
