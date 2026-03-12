import { useEffect, useMemo, useRef, useState } from 'react';
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

interface LayoutProps {
  onToggleTheme: () => void;
}

interface NavSection {
  label: string;
  icon: React.ElementType;
  items: Array<{ label: string; href: string; icon: React.ElementType }>;
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
      { label: 'Runtime Defaults', href: '/config/runtime-defaults', icon: Settings2 },
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

export function DashboardLayout({ onToggleTheme }: LayoutProps): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const session = readSession();

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<DashboardSearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
      if (event.key === 'Escape') {
        setSearchOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const submitSearch = async (): Promise<void> => {
    const query = searchQuery.trim();
    if (query.length < 2) return;

    try {
      const results = await dashboardApi.search(query);
      setSearchResults(results);
      if (results.length === 1) {
        navigate(results[0].href);
        setSearchOpen(false);
      }
    } catch {
      /* search failed silently */
    }
  };

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
          onClick={() => {
            setSearchOpen(true);
            setIsMobileMenuOpen(false);
            setTimeout(() => searchInputRef.current?.focus(), 0);
          }}
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
          onClick={() => {
            setSearchOpen(true);
            setTimeout(() => searchInputRef.current?.focus(), 0);
          }}
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
          onClick={() => setSearchOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-lg border border-border bg-surface p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submitSearch();
              }}
            >
              <div className="flex items-center gap-2">
                <Search size={16} className="text-muted" />
                <input
                  ref={searchInputRef}
                  className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
                  placeholder="Search workflows, tasks, workers..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </form>
            {searchResults.length > 0 && (
              <ul className="mt-3 max-h-60 space-y-1 overflow-y-auto border-t border-border pt-2">
                {searchResults.map((result) => (
                  <li key={`${result.type}:${result.id}`}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm hover:bg-border/30"
                      onClick={() => {
                        navigate(result.href);
                        setSearchOpen(false);
                      }}
                    >
                      <span>{result.label}</span>
                      <span className="text-xs text-muted">{result.type}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
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
  const [expanded, setExpanded] = useState(isActive);
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
