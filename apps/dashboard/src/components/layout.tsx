import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  Bell,
  Box,
  ChevronRight,
  Clipboard,
  Cog,
  Container,
  Database,
  FileText,
  FolderOpen,
  Gauge,
  HardDrive,
  Key,
  LayoutDashboard,
  Link2,
  Lock,
  LogOut,
  Moon,
  ScrollText,
  Search,
  Server,
  Shield,
  Sun,
  Timer,
  Users,
  Workflow,
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
      { label: 'Activity Feed', href: '/mission-control/activity', icon: Activity },
      { label: 'Alerts & Approvals', href: '/mission-control/alerts', icon: Bell },
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
      { label: 'Templates', href: '/config/templates', icon: FileText },
      { label: 'Role Definitions', href: '/config/roles', icon: Users },
      { label: 'Platform Instructions', href: '/config/instructions', icon: ScrollText },
      { label: 'LLM Providers', href: '/config/llm', icon: Cog },
      { label: 'Runtimes', href: '/config/runtimes', icon: Server },
      { label: 'Integrations', href: '/config/integrations', icon: Link2 },
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
      { label: 'Audit Log', href: '/governance/audit', icon: Shield },
      { label: 'Retention Policy', href: '/governance/retention', icon: Timer },
      { label: 'Legal Holds', href: '/governance/legal-holds', icon: Lock },
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
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const isDark = readTheme() === 'dark';

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

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 flex-col border-r border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-lg font-semibold">Agirunner</span>
          <button
            type="button"
            onClick={onToggleTheme}
            className="rounded-md p-1.5 text-muted hover:bg-border/50"
            aria-label="Toggle theme"
          >
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>

        <div className="px-3 py-2">
          <button
            type="button"
            onClick={() => {
              setSearchOpen(true);
              setTimeout(() => searchInputRef.current?.focus(), 0);
            }}
            className="flex w-full items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:bg-border/30"
          >
            <Search size={14} />
            <span>Search...</span>
            <kbd className="ml-auto rounded border border-border px-1.5 py-0.5 text-xs">
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
      </aside>

      <main className="flex-1 overflow-y-auto bg-background">
        <div className="mx-auto max-w-7xl px-6 py-4">
          <Outlet />
        </div>
      </main>

      {searchOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24"
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
