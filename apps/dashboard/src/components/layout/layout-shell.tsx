import type { KeyboardEvent as ReactKeyboardEvent, MutableRefObject, RefObject } from 'react';
import { Outlet } from 'react-router-dom';
import { cn } from '../../lib/utils.js';
import { BreadcrumbBar } from './breadcrumb-bar.js';
import {
  CommandPaletteDialog,
  restoreFocusToElement,
} from './layout-command-palette.js';
import type {
  CommandPaletteItem,
  CommandPaletteSection,
  CommandPaletteStatus,
} from './layout-search.js';
import { SIDEBAR_SHELL_CLASSES } from './layout-nav.js';
import { MobileTopBar, SidebarPanel } from './layout-sidebar.js';
import { Dialog, DialogDescription, DialogContent, DialogTitle } from '../ui/dialog.js';

type CommandPaletteRowSection = CommandPaletteSection & {
  rows: Array<{ item: CommandPaletteItem; index: number }>;
};

interface DashboardLayoutShellProps {
  isMobileMenuOpen: boolean;
  searchOpen: boolean;
  currentSection: string;
  isDark: boolean;
  isDesktopSidebarCollapsed: boolean;
  shouldSearchWorkspace: boolean;
  searchQuery: string;
  searchStatus: CommandPaletteStatus;
  activePaletteIndex: number;
  visiblePaletteItems: CommandPaletteItem[];
  visiblePaletteRows: CommandPaletteRowSection[];
  paletteState: { title: string; detail: string };
  desktopSearchButtonRef: RefObject<HTMLButtonElement | null>;
  mobileMenuTriggerRef: RefObject<HTMLButtonElement | null>;
  mobileSearchButtonRef: RefObject<HTMLButtonElement | null>;
  mobileMenuCloseButtonRef: RefObject<HTMLButtonElement | null>;
  searchInputRef: RefObject<HTMLInputElement | null>;
  paletteItemRefs: MutableRefObject<Array<HTMLButtonElement | null>>;
  searchRestoreFocusRef: RefObject<HTMLElement | null>;
  mobileMenuRestoreFocusRef: RefObject<HTMLElement | null>;
  skipMobileMenuRestoreRef: MutableRefObject<boolean>;
  onOpenMobileMenu(): void;
  onCloseMobileMenu(): void;
  onOpenSearchPalette(): void;
  onMobileMenuOpenChange(nextOpen: boolean): void;
  onToggleDesktopSidebar(): void;
  onToggleTheme(): void;
  onLogout(): void;
  onSearchOpenChange(nextOpen: boolean): void;
  onSearchQueryChange(value: string): void;
  onInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void;
  onActivePaletteIndexChange(index: number): void;
  onNavigateToPaletteItem(item: CommandPaletteItem): void;
}

export function DashboardLayoutShell(props: DashboardLayoutShellProps): JSX.Element {
  return (
    <div className="flex h-dvh min-h-screen overflow-hidden">
      <MobileTopBar
        isMobileMenuOpen={props.isMobileMenuOpen}
        searchOpen={props.searchOpen}
        mobileMenuTriggerRef={props.mobileMenuTriggerRef}
        mobileSearchButtonRef={props.mobileSearchButtonRef}
        onOpenMobileMenu={props.onOpenMobileMenu}
        onOpenSearchPalette={props.onOpenSearchPalette}
      />

      <Dialog open={props.isMobileMenuOpen} onOpenChange={props.onMobileMenuOpenChange}>
        <DialogContent
          showCloseButton={false}
          className={cn(
            'left-0 top-0 h-dvh w-64 max-w-none translate-x-0 translate-y-0 gap-0 rounded-none p-0 shadow-2xl lg:hidden',
            SIDEBAR_SHELL_CLASSES,
          )}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            props.mobileMenuCloseButtonRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (props.skipMobileMenuRestoreRef.current) {
              props.skipMobileMenuRestoreRef.current = false;
              return;
            }
            restoreFocusToElement(props.mobileMenuRestoreFocusRef.current) ||
              restoreFocusToElement(props.mobileMenuTriggerRef.current);
          }}
        >
          <DialogTitle className="sr-only">Navigation menu</DialogTitle>
          <DialogDescription className="sr-only">
            Browse workspace sections and account actions.
          </DialogDescription>
          <SidebarPanel
            isMobile
            currentSection={props.currentSection}
            searchOpen={props.searchOpen}
            isDark={props.isDark}
            isDesktopSidebarCollapsed={props.isDesktopSidebarCollapsed}
            desktopSearchButtonRef={props.desktopSearchButtonRef}
            mobileMenuCloseButtonRef={props.mobileMenuCloseButtonRef}
            onOpenSearchPalette={props.onOpenSearchPalette}
            onCloseMobileMenu={props.onCloseMobileMenu}
            onToggleDesktopSidebar={props.onToggleDesktopSidebar}
            onToggleTheme={props.onToggleTheme}
            onLogout={props.onLogout}
          />
        </DialogContent>
      </Dialog>

      <aside className={cn('hidden flex-col lg:flex', SIDEBAR_SHELL_CLASSES)}>
        <SidebarPanel
          isMobile={false}
          currentSection={props.currentSection}
          searchOpen={props.searchOpen}
          isDark={props.isDark}
          isDesktopSidebarCollapsed={props.isDesktopSidebarCollapsed}
          desktopSearchButtonRef={props.desktopSearchButtonRef}
          mobileMenuCloseButtonRef={props.mobileMenuCloseButtonRef}
          onOpenSearchPalette={props.onOpenSearchPalette}
          onCloseMobileMenu={props.onCloseMobileMenu}
          onToggleDesktopSidebar={props.onToggleDesktopSidebar}
          onToggleTheme={props.onToggleTheme}
          onLogout={props.onLogout}
        />
      </aside>

      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background pt-12 lg:pt-0">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col px-4 py-4 sm:px-6 lg:px-8">
          <BreadcrumbBar />
          <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
            <Outlet />
          </div>
        </div>
      </main>

      <CommandPaletteDialog
        open={props.searchOpen}
        shouldSearchWorkspace={props.shouldSearchWorkspace}
        searchQuery={props.searchQuery}
        searchStatus={props.searchStatus}
        activePaletteIndex={props.activePaletteIndex}
        searchInputRef={props.searchInputRef}
        desktopSearchButtonRef={props.desktopSearchButtonRef}
        mobileSearchButtonRef={props.mobileSearchButtonRef}
        searchRestoreFocusRef={props.searchRestoreFocusRef}
        paletteItemRefs={props.paletteItemRefs}
        visiblePaletteItems={props.visiblePaletteItems}
        visiblePaletteRows={props.visiblePaletteRows}
        paletteState={props.paletteState}
        onOpenChange={props.onSearchOpenChange}
        onSearchQueryChange={props.onSearchQueryChange}
        onInputKeyDown={props.onInputKeyDown}
        onActivePaletteIndexChange={props.onActivePaletteIndexChange}
        onNavigateToPaletteItem={props.onNavigateToPaletteItem}
      />
    </div>
  );
}
