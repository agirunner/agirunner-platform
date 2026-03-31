import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';

import { dashboardApi, type DashboardSearchResult } from '../../lib/api.js';
import { clearSession, readSession } from '../../lib/auth/session.js';
import { readTheme } from '../../app/theme.js';
import { readActiveElement } from './layout-command-palette.js';
import { DashboardLayoutShell } from './layout-shell.js';
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
import {
  buildDesktopSidebarStorageKey,
  COMMAND_PALETTE_QUICK_LINKS,
  NAV_SECTIONS,
  readDesktopSidebarCollapsedState,
} from './layout-nav.js';

interface LayoutProps {
  onToggleTheme: () => void;
}

export function DashboardLayout({ onToggleTheme }: LayoutProps): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const session = readSession();
  const desktopSidebarStorageKey = buildDesktopSidebarStorageKey(session?.tenantId ?? null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<DashboardSearchResult[]>([]);
  const [searchStatus, setSearchStatus] = useState<CommandPaletteStatus>('idle');
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activePaletteIndex, setActivePaletteIndex] = useState(-1);
  const [recentPaletteItems, setRecentPaletteItems] = useState<CommandPaletteItem[]>(() =>
    readRecentCommandPaletteItems(),
  );
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isDesktopSidebarCollapsed, setIsDesktopSidebarCollapsed] = useState(() =>
    typeof localStorage === 'undefined'
      ? false
      : readDesktopSidebarCollapsedState(localStorage, session?.tenantId ?? null),
  );
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

  useEffect(() => {
    if (typeof localStorage === 'undefined') {
      setIsDesktopSidebarCollapsed(false);
      return;
    }
    setIsDesktopSidebarCollapsed(
      readDesktopSidebarCollapsedState(localStorage, session?.tenantId ?? null),
    );
  }, [session?.tenantId]);

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

  function toggleDesktopSidebar(): void {
    setIsDesktopSidebarCollapsed((current) => {
      const nextCollapsed = !current;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(desktopSidebarStorageKey, nextCollapsed ? 'true' : 'false');
      }
      return nextCollapsed;
    });
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

  return (
    <DashboardLayoutShell
      isMobileMenuOpen={isMobileMenuOpen}
      searchOpen={searchOpen}
      currentSection={currentSection}
      isDark={isDark}
      isDesktopSidebarCollapsed={isDesktopSidebarCollapsed}
      shouldSearchWorkspace={shouldSearchWorkspace}
      searchQuery={searchQuery}
      searchStatus={searchStatus}
      activePaletteIndex={activePaletteIndex}
      visiblePaletteItems={visiblePaletteItems}
      visiblePaletteRows={visiblePaletteRows}
      paletteState={paletteState}
      desktopSearchButtonRef={desktopSearchButtonRef}
      mobileMenuTriggerRef={mobileMenuTriggerRef}
      mobileSearchButtonRef={mobileSearchButtonRef}
      mobileMenuCloseButtonRef={mobileMenuCloseButtonRef}
      searchInputRef={searchInputRef}
      paletteItemRefs={paletteItemRefs}
      searchRestoreFocusRef={searchRestoreFocusRef}
      mobileMenuRestoreFocusRef={mobileMenuRestoreFocusRef}
      skipMobileMenuRestoreRef={skipMobileMenuRestoreRef}
      onOpenMobileMenu={openMobileMenu}
      onCloseMobileMenu={closeMobileMenu}
      onOpenSearchPalette={openSearchPalette}
      onMobileMenuOpenChange={setIsMobileMenuOpen}
      onToggleDesktopSidebar={toggleDesktopSidebar}
      onToggleTheme={onToggleTheme}
      onLogout={logout}
      onSearchOpenChange={(nextOpen) => {
        if (nextOpen) {
          setSearchOpen(true);
          return;
        }
        closeSearchPalette();
      }}
      onSearchQueryChange={setSearchQuery}
      onInputKeyDown={handlePaletteInputKeyDown}
      onActivePaletteIndexChange={setActivePaletteIndex}
      onNavigateToPaletteItem={navigateToPaletteItem}
    />
  );
}

export {
  buildDesktopSidebarStorageKey,
  findNavigationItemByHref,
  NAV_SECTIONS,
  readDesktopSidebarCollapsedState,
} from './layout-nav.js';
export { buildBreadcrumbs } from './layout-breadcrumbs.js';
