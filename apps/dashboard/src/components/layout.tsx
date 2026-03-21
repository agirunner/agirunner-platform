import { useEffect, useMemo, useRef, useState } from 'react';
import type { ElementType, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  Bot,
  ChevronRight,
  Clipboard,
  Cog,
  Container,
  DollarSign,
  FileText,
  FolderOpen,
  Gauge,
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
import { BreadcrumbBar } from './breadcrumb-bar.js';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from './ui/dialog.js';
import {
  buildCommandPaletteSections,
  clearRecentCommandPaletteItems,
  COMMAND_PALETTE_DEBOUNCE_MS,
  describeCommandPaletteState,
  filterCommandPaletteQuickLinks,
  moveCommandPaletteSelection,
  readRecentCommandPaletteItems,
  recordRecentCommandPaletteItem,
  shouldRunCommandPaletteSearch,
  type CommandPaletteActionId,
  type CommandPaletteItem,
  type CommandPaletteStatus,
} from './layout-search.js';

interface LayoutProps {
  onToggleTheme: () => void;
}

interface NavItem {
  label: string;
  href: string;
  icon: ElementType;
  keywords?: string[];
}

interface NavSection {
  label: string;
  icon: ElementType;
  items: NavItem[];
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
      {
        label: 'Workflow Boards',
        href: '/work/boards',
        icon: Workflow,
        keywords: ['workflow', 'workflows', 'board', 'boards', 'delivery board', 'board run'],
      },
      { label: 'Tasks', href: '/work/tasks', icon: Clipboard },
      { label: 'Approval Queue', href: '/work/approvals', icon: Bell },
    ],
  },
  {
    label: 'Configuration',
    icon: Cog,
    items: [
      { label: 'Workspaces', href: '/workspaces', icon: FolderOpen },
      { label: 'Playbooks', href: '/config/playbooks', icon: Workflow },
      { label: 'Orchestrator', href: '/config/orchestrator', icon: Bot, keywords: ['orchestrator', 'prompt', 'model routing', 'pool posture'] },
      { label: 'Roles', href: '/config/roles', icon: Users, keywords: ['specialist', 'agent roles', 'role definitions'] },
      { label: 'Platform Instructions', href: '/config/instructions', icon: ScrollText },
      { label: 'Model Routing', href: '/config/llm', icon: Cog },
      { label: 'Tools', href: '/config/tools', icon: Wrench },
      { label: 'AI Assistant', href: '/config/assistant', icon: Sparkles },
    ],
  },
  {
    label: 'Integrations',
    icon: Link2,
    items: [
      { label: 'Webhooks', href: '/config/webhooks', icon: Webhook },
      { label: 'Triggers', href: '/config/triggers', icon: Zap },
      { label: 'Agent Protocols', href: '/config/agent-protocols', icon: Bot },
    ],
  },
  {
    label: 'Fleet',
    icon: Server,
    items: [
      { label: 'Runtimes', href: '/config/runtimes', icon: Server },
      { label: 'Containers', href: '/fleet/containers', icon: Container },
    ],
  },
  {
    label: 'Governance',
    icon: Shield,
    items: [
      { label: 'Settings', href: '/governance/settings', icon: Settings2 },
      { label: 'Retention Policy', href: '/governance/retention', icon: Timer },
      { label: 'API Keys', href: '/governance/api-keys', icon: Key },
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
    ...(item.keywords?.length ? { keywords: item.keywords } : {}),
  })),
);

const FOCUS_RING_CLASSES =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

const ICON_BUTTON_CLASSES = cn(
  'rounded-md p-1.5 text-muted transition-colors hover:bg-border/50 hover:text-foreground',
  FOCUS_RING_CLASSES,
);

function readActiveElement(): HTMLElement | null {
  return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

function restoreFocusToElement(element: HTMLElement | null): boolean {
  if (!element || !element.isConnected || element.getClientRects().length === 0) {
    return false;
  }
  element.focus();
  return document.activeElement === element;
}

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
  const [recentPaletteItems, setRecentPaletteItems] = useState<CommandPaletteItem[]>(
    () => readRecentCommandPaletteItems(),
  );
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const desktopSearchButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobileMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mobileSearchButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobileMenuCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const paletteItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const searchRestoreFocusRef = useRef<HTMLElement | null>(null);
  const mobileMenuRestoreFocusRef = useRef<HTMLElement | null>(null);
  const skipMobileMenuRestoreRef = useRef(false);
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
  const quickLinks = useMemo(
    () => filterCommandPaletteQuickLinks(COMMAND_PALETTE_QUICK_LINKS, searchQuery),
    [searchQuery],
  );
  const actionItems = useMemo<Array<CommandPaletteItem>>(
    () => [
      {
        id: 'action:toggle-theme',
        label: isDark ? 'Switch to light theme' : 'Switch to dark theme',
        meta: 'Appearance',
        kind: 'action',
        actionId: 'toggle-theme',
        keywords: ['theme', 'appearance', isDark ? 'light' : 'dark'],
      },
      {
        id: 'action:refresh-view',
        label: 'Refresh current view',
        meta: 'Workspace',
        kind: 'action',
        actionId: 'refresh-view',
        keywords: ['refresh', 'reload', 'invalidate'],
      },
      {
        id: 'action:logout',
        label: 'Log out',
        meta: 'Session',
        kind: 'action',
        actionId: 'logout',
        keywords: ['logout', 'sign out', 'session'],
      },
      {
        id: 'action:clear-recents',
        label: 'Clear recent items',
        meta: 'Command Palette',
        kind: 'action',
        actionId: 'clear-recents',
        keywords: ['recent', 'clear', 'history'],
      },
    ],
    [isDark],
  );
  const visiblePaletteSections = useMemo(
    () =>
      buildCommandPaletteSections({
        query: searchQuery,
        actionItems,
        recentItems: recentPaletteItems,
        quickLinks,
        searchResults,
      }),
    [actionItems, quickLinks, recentPaletteItems, searchQuery, searchResults],
  );
  const visiblePaletteRows = useMemo(() => {
    let index = 0;
    return visiblePaletteSections.map((section) => ({
      ...section,
      rows: section.items.map((item) => ({ item, index: index++ })),
    }));
  }, [visiblePaletteSections]);
  const visiblePaletteItems = useMemo(
    () => visiblePaletteRows.flatMap((section) => section.rows.map((row) => row.item)),
    [visiblePaletteRows],
  );
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
    searchRestoreFocusRef.current = readActiveElement();
    if (isMobileMenuOpen) {
      skipMobileMenuRestoreRef.current = true;
    }
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

  function openMobileMenu(): void {
    mobileMenuRestoreFocusRef.current = readActiveElement();
    setIsMobileMenuOpen(true);
  }

  function closeMobileMenu(): void {
    setIsMobileMenuOpen(false);
  }

  function logout(): void {
    void dashboardApi.logout().finally(() => {
      clearSession();
      queryClient.clear();
      navigate('/login');
    });
  }

  useEffect(() => {
    if (!searchOpen) {
      return;
    }
    setRecentPaletteItems(readRecentCommandPaletteItems());
  }, [searchOpen]);

  function executeCommandPaletteAction(actionId: CommandPaletteActionId): void {
    if (actionId === 'toggle-theme') {
      onToggleTheme();
      closeSearchPalette();
      return;
    }
    if (actionId === 'refresh-view') {
      void queryClient.invalidateQueries();
      closeSearchPalette();
      return;
    }
    if (actionId === 'clear-recents') {
      setRecentPaletteItems(clearRecentCommandPaletteItems());
      closeSearchPalette();
      return;
    }
    logout();
    closeSearchPalette();
  }

  function navigateToPaletteItem(item: CommandPaletteItem): void {
    setRecentPaletteItems(recordRecentCommandPaletteItem(item));
    if (item.actionId) {
      executeCommandPaletteAction(item.actionId);
      return;
    }
    if (!item.href) {
      return;
    }
    navigate(item.href);
    closeSearchPalette();
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openSearchPalette();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isMobileMenuOpen]);

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

  function renderSidebarContent(isMobile: boolean): JSX.Element {
    return (
      <>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <img src="/logo.svg" alt="" className="h-7 w-7" />
            <span className="text-lg font-semibold">AGI Runner</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onToggleTheme}
              className={ICON_BUTTON_CLASSES}
              aria-label="Toggle theme"
            >
              {isDark ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            {isMobile ? (
              <button
                ref={mobileMenuCloseButtonRef}
                type="button"
                onClick={closeMobileMenu}
                className={ICON_BUTTON_CLASSES}
                aria-label="Close navigation menu"
              >
                <X size={16} />
              </button>
            ) : null}
          </div>
        </div>

        <div className="px-3 py-2">
          <button
            ref={isMobile ? undefined : desktopSearchButtonRef}
            type="button"
            onClick={openSearchPalette}
            className={cn(
              'flex w-full items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:bg-border/30 hover:text-foreground',
              FOCUS_RING_CLASSES,
            )}
            aria-haspopup="dialog"
            aria-expanded={searchOpen}
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
          <button
            type="button"
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted transition-colors hover:bg-border/30 hover:text-foreground',
              FOCUS_RING_CLASSES,
            )}
            onClick={logout}
          >
            <LogOut size={14} />
            Logout
          </button>
        </div>
      </>
    );
  }

  return (
    <div className="flex min-h-screen">
      <div className="fixed left-0 right-0 top-0 z-30 flex items-center justify-between border-b border-border bg-surface px-4 py-2 lg:hidden">
        <button
          ref={mobileMenuTriggerRef}
          type="button"
          onClick={openMobileMenu}
          className={ICON_BUTTON_CLASSES}
          aria-label="Open menu"
          aria-haspopup="dialog"
          aria-expanded={isMobileMenuOpen}
        >
          <Menu size={20} />
        </button>
        <div className="flex items-center gap-2">
          <img src="/logo.svg" alt="" className="h-5 w-5" />
          <span className="text-sm font-semibold">AGI Runner</span>
        </div>
        <button
          ref={mobileSearchButtonRef}
          type="button"
          onClick={openSearchPalette}
          className={ICON_BUTTON_CLASSES}
          aria-label="Open command palette"
          aria-haspopup="dialog"
          aria-expanded={searchOpen}
        >
          <Search size={18} />
        </button>
      </div>

      <Dialog open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
        <DialogContent
          showCloseButton={false}
          className="left-0 top-0 h-dvh w-60 max-w-none translate-x-0 translate-y-0 gap-0 rounded-none border-r border-border bg-surface p-0 shadow-xl lg:hidden"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            mobileMenuCloseButtonRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (skipMobileMenuRestoreRef.current) {
              skipMobileMenuRestoreRef.current = false;
              return;
            }
            restoreFocusToElement(mobileMenuRestoreFocusRef.current)
              || restoreFocusToElement(mobileMenuTriggerRef.current);
          }}
        >
          <DialogTitle className="sr-only">Navigation menu</DialogTitle>
          <DialogDescription className="sr-only">
            Browse workspace sections and account actions.
          </DialogDescription>
          {renderSidebarContent(true)}
        </DialogContent>
      </Dialog>

      <aside className="hidden w-60 flex-col border-r border-border bg-surface lg:flex">
        {renderSidebarContent(false)}
      </aside>

      <main className="flex-1 overflow-y-auto bg-background pt-12 lg:pt-0">
        <div className="px-4 py-4 sm:px-6 lg:px-8">
          <BreadcrumbBar />
          <Outlet />
        </div>
      </main>

      <Dialog
        open={searchOpen}
        onOpenChange={(nextOpen) => {
          if (nextOpen) {
            setSearchOpen(true);
            return;
          }
          closeSearchPalette();
        }}
      >
        <DialogContent
          showCloseButton={false}
          closeLabel="Close command palette"
          className="max-w-2xl gap-3 rounded-2xl border-border/80 bg-surface/95 p-4 backdrop-blur"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            searchInputRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocusToElement(searchRestoreFocusRef.current)
              || restoreFocusToElement(mobileSearchButtonRef.current)
              || restoreFocusToElement(desktopSearchButtonRef.current);
          }}
        >
          <div className="space-y-3">
            <div className="space-y-1">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <DialogTitle className="text-sm font-semibold text-foreground">
                    Search the workspace
                  </DialogTitle>
                  <DialogDescription className="text-xs text-muted">
                    Workflow boards, tasks, workspaces, playbooks, workers, and agents.
                  </DialogDescription>
                </div>
                <div className="flex items-center gap-2">
                  <kbd className="rounded border border-border px-1.5 py-0.5 text-xs text-muted">
                    Esc
                  </kbd>
                  <DialogClose asChild>
                    <button
                      type="button"
                      className={ICON_BUTTON_CLASSES}
                      aria-label="Close command palette"
                    >
                      <X size={16} />
                    </button>
                  </DialogClose>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border/80 bg-background/70 px-3 py-2">
              <div className="flex items-center gap-2">
                <Search size={16} className="text-muted" />
                <input
                  ref={searchInputRef}
                  className={cn(
                    'flex-1 bg-transparent text-sm placeholder:text-muted',
                    FOCUS_RING_CLASSES,
                  )}
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

            {visiblePaletteRows.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3 px-1">
                  <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted">
                    {shouldSearchWorkspace ? 'Commands and results' : 'Actions and shortcuts'}
                  </p>
                  <p className="text-xs text-muted">
                    {`${visiblePaletteItems.length} items`}
                  </p>
                </div>
                <div
                  id="dashboard-command-palette-results"
                  role="listbox"
                  className="max-h-72 space-y-3 overflow-y-auto"
                >
                  {visiblePaletteRows.map((section) => (
                    <div key={section.id} className="space-y-1">
                      <div className="px-1 text-[11px] font-medium uppercase tracking-[0.2em] text-muted">
                        {section.title}
                      </div>
                      <ul className="space-y-1">
                        {section.rows.map(({ item, index }) => (
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
                                FOCUS_RING_CLASSES,
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
                  ))}
                </div>
              </div>
            ) : null}

            {!shouldSearchWorkspace && visiblePaletteItems.length === 0 ? (
              <p className="px-1 text-xs text-muted">
                No quick links match that text yet. Keep typing to search the full workspace.
              </p>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
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
          FOCUS_RING_CLASSES,
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
                  FOCUS_RING_CLASSES,
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

export { buildBreadcrumbs } from './layout-breadcrumbs.js';
