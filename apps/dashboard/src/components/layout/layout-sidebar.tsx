import type { RefObject } from 'react';
import { ChevronRight, LogOut, Menu, Moon, Search, Sun, X } from 'lucide-react';

import { cn } from '../../lib/utils.js';
import { LayoutVersionPopover } from './layout-version-popover.js';
import {
  FOCUS_RING_CLASSES,
  ICON_BUTTON_CLASSES,
  NavSectionGroup,
  NAV_SECTIONS,
  SIDEBAR_SHELL_CLASSES,
} from './layout-nav.js';

export function MobileTopBar(props: {
  isMobileMenuOpen: boolean;
  searchOpen: boolean;
  mobileMenuTriggerRef: RefObject<HTMLButtonElement>;
  mobileSearchButtonRef: RefObject<HTMLButtonElement>;
  onOpenMobileMenu(): void;
  onOpenSearchPalette(): void;
}): JSX.Element {
  return (
    <div className="fixed left-0 right-0 top-0 z-30 flex items-center justify-between border-b border-stone-200/90 bg-stone-100/95 px-4 py-2 dark:border-slate-800 dark:bg-slate-950 lg:hidden">
      <button
        ref={props.mobileMenuTriggerRef}
        type="button"
        onClick={props.onOpenMobileMenu}
        className={ICON_BUTTON_CLASSES}
        aria-label="Open menu"
        aria-haspopup="dialog"
        aria-expanded={props.isMobileMenuOpen}
      >
        <Menu size={20} />
      </button>
      <div className="flex items-center gap-2">
        <img src="/logo.svg" alt="" className="h-5 w-5" />
        <span className="text-sm font-semibold">Agirunner</span>
      </div>
      <button
        ref={props.mobileSearchButtonRef}
        type="button"
        onClick={props.onOpenSearchPalette}
        className={ICON_BUTTON_CLASSES}
        aria-label="Open command palette"
        aria-haspopup="dialog"
        aria-expanded={props.searchOpen}
      >
        <Search size={18} />
      </button>
    </div>
  );
}

export function SidebarPanel(props: {
  isMobile: boolean;
  currentSection: string;
  searchOpen: boolean;
  isDark: boolean;
  isDesktopSidebarCollapsed: boolean;
  desktopSearchButtonRef: RefObject<HTMLButtonElement>;
  mobileMenuCloseButtonRef: RefObject<HTMLButtonElement>;
  onOpenSearchPalette(): void;
  onCloseMobileMenu(): void;
  onToggleDesktopSidebar(): void;
  onToggleTheme(): void;
  onLogout(): void;
}): JSX.Element {
  const isCollapsedDesktopRail = !props.isMobile && props.isDesktopSidebarCollapsed;
  const desktopSidebarToggleLabel = props.isDesktopSidebarCollapsed
    ? 'Expand sidebar'
    : 'Collapse sidebar';
  const sidebarWidthClass = props.isMobile
    ? 'w-64'
    : props.isDesktopSidebarCollapsed
      ? 'w-20'
      : 'w-64';

  return (
    <div className={cn('flex h-full flex-col', sidebarWidthClass)}>
      <div
        className={cn(
          'flex border-b border-stone-200/90 px-4 py-3 dark:border-slate-800',
          isCollapsedDesktopRail
            ? 'relative items-center justify-center'
            : 'items-center justify-between',
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <img src="/logo.svg" alt="" className="h-7 w-7" />
          {isCollapsedDesktopRail ? null : (
            <span className="text-lg font-semibold">Agirunner</span>
          )}
        </div>
        <div
          className={cn(
            'flex items-center gap-1',
            isCollapsedDesktopRail ? 'absolute right-2 top-3 flex-col' : '',
          )}
        >
          {!props.isMobile ? (
            <button
              type="button"
              onClick={props.onToggleDesktopSidebar}
              className={ICON_BUTTON_CLASSES}
              aria-label={desktopSidebarToggleLabel}
              title={desktopSidebarToggleLabel}
            >
              <ChevronRight
                size={16}
                className={cn(
                  'transition-transform',
                  !props.isDesktopSidebarCollapsed && 'rotate-180',
                )}
              />
            </button>
          ) : null}
          <button
            type="button"
            onClick={props.onToggleTheme}
            className={ICON_BUTTON_CLASSES}
            aria-label="Toggle theme"
          >
            {props.isDark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          {props.isMobile ? (
            <button
              ref={props.mobileMenuCloseButtonRef}
              type="button"
              onClick={props.onCloseMobileMenu}
              className={ICON_BUTTON_CLASSES}
              aria-label="Close navigation menu"
            >
              <X size={16} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="px-3 py-3">
        <button
          ref={props.isMobile ? undefined : props.desktopSearchButtonRef}
          type="button"
          onClick={props.onOpenSearchPalette}
          className={cn(
            'flex w-full items-center rounded-xl border border-stone-200 bg-white/88 text-sm text-slate-700 shadow-sm transition-[background-color,color,box-shadow] hover:bg-white hover:text-slate-950 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-slate-100',
            isCollapsedDesktopRail ? 'justify-center px-0 py-2.5' : 'gap-2 px-3 py-2',
            FOCUS_RING_CLASSES,
          )}
          aria-haspopup="dialog"
          aria-expanded={props.searchOpen}
          aria-label={isCollapsedDesktopRail ? 'Search the workspace' : undefined}
          title={isCollapsedDesktopRail ? 'Search the workspace' : undefined}
        >
          <Search size={14} />
          {isCollapsedDesktopRail ? null : <span>Search...</span>}
          <kbd
            className={cn(
              'ml-auto hidden rounded border border-border px-1.5 py-0.5 text-xs sm:inline',
              isCollapsedDesktopRail && 'hidden',
            )}
          >
            {'\u2318'}K
          </kbd>
        </button>
      </div>

      <nav
        className={cn('flex-1 overflow-y-auto py-2', isCollapsedDesktopRail ? 'px-2' : 'px-3')}
        aria-label={props.isMobile ? 'Navigation menu' : 'Desktop navigation'}
      >
        {NAV_SECTIONS.map((section) => (
          <NavSectionGroup
            key={section.label}
            section={section}
            isActive={props.currentSection === section.label}
            isSidebarCollapsed={isCollapsedDesktopRail}
          />
        ))}
      </nav>

      <div className="border-t border-stone-300/70 p-3 dark:border-slate-800">
        <div className="mb-1">
          <LayoutVersionPopover isSidebarCollapsed={isCollapsedDesktopRail} />
        </div>
        <button
          type="button"
          className={cn(
            'flex w-full items-center rounded-xl text-sm text-slate-700 transition-[background-color,color] hover:bg-white hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-900/80 dark:hover:text-slate-100',
            isCollapsedDesktopRail ? 'justify-center px-0 py-2.5' : 'gap-2 px-3 py-2',
            FOCUS_RING_CLASSES,
          )}
          onClick={props.onLogout}
          aria-label={isCollapsedDesktopRail ? 'Logout' : undefined}
          title={isCollapsedDesktopRail ? 'Logout' : undefined}
        >
          <LogOut size={14} />
          {isCollapsedDesktopRail ? null : 'Logout'}
        </button>
      </div>
    </div>
  );
}

export { SIDEBAR_SHELL_CLASSES };
