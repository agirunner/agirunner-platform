import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { dashboardApi, type DashboardSearchResult } from '../lib/api.js';
import { readSession } from '../lib/session.js';

interface LayoutProps {
  onToggleTheme: () => void;
}

interface BreadcrumbItem {
  label: string;
  href?: string;
}

const SECTION_LABELS: Record<string, string> = {
  pipelines: 'Pipelines',
  tasks: 'Tasks',
  workers: 'Workers',
  activity: 'Activity Feed',
  metrics: 'System Metrics',
};

export function DashboardLayout({ onToggleTheme }: LayoutProps): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const session = readSession();

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<DashboardSearchResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const breadcrumbs = useMemo(() => buildBreadcrumbs(location.pathname), [location.pathname]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        if (isEditableTarget(event.target)) {
          return;
        }

        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      if (event.altKey && event.key === '1') {
        event.preventDefault();
        navigate('/pipelines');
      } else if (event.altKey && event.key === '2') {
        event.preventDefault();
        navigate('/workers');
      } else if (event.altKey && event.key === '3') {
        event.preventDefault();
        navigate('/activity');
      } else if (event.altKey && event.key === '4') {
        event.preventDefault();
        navigate('/metrics');
      } else if (event.shiftKey && event.key.toLowerCase() === 'r') {
        event.preventDefault();
        void queryClient.invalidateQueries();
      } else if (event.shiftKey && event.key.toLowerCase() === 't') {
        event.preventDefault();
        onToggleTheme();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [navigate, onToggleTheme, queryClient]);

  const submitSearch = async (): Promise<void> => {
    const query = searchQuery.trim();
    if (query.length < 2) {
      setSearchResults([]);
      setSearchError('Enter at least 2 characters to search.');
      return;
    }

    try {
      const results = await dashboardApi.search(query);
      setSearchResults(results);
      setSearchError(null);
      if (results.length === 1) {
        navigate(results[0].href);
      }
    } catch {
      setSearchError('Search failed. Try again.');
    }
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <strong>AgentBaton</strong>
          <button className="button" type="button" onClick={onToggleTheme}>
            Theme
          </button>
        </div>
        <p className="muted">Tenant {session?.tenantId}</p>
        <form
          className="search-panel"
          onSubmit={(event) => {
            event.preventDefault();
            void submitSearch();
          }}
        >
          <label htmlFor="dashboard-search">Global Search</label>
          <div className="row">
            <input
              id="dashboard-search"
              ref={searchInputRef}
              className="input"
              placeholder="Search pipelines, tasks, workers, agents (/ to focus)"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            <button className="button" type="submit">
              Go
            </button>
          </div>
          {searchError ? <p className="muted">{searchError}</p> : null}
          {searchResults.length > 0 ? (
            <ul className="search-results">
              {searchResults.map((result) => (
                <li key={`${result.type}:${result.id}`}>
                  <button
                    type="button"
                    className="button search-result-button"
                    onClick={() => {
                      navigate(result.href);
                      setSearchResults([]);
                    }}
                  >
                    <span>{result.label}</span>
                    <span className="muted">
                      {result.type} · {result.subtitle}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </form>
        <nav>
          <NavLink to="/pipelines">Pipelines</NavLink>
          <NavLink to="/workers">Workers</NavLink>
          <NavLink to="/activity">Activity Feed</NavLink>
          <NavLink to="/metrics">System Metrics</NavLink>
        </nav>
        <p className="muted shortcut-hint">Shortcuts: Alt+1/2/3/4 navigate · Shift+R refresh · Shift+T theme</p>
        <button
          className="button"
          type="button"
          onClick={() => {
            dashboardApi.logout();
            navigate('/login');
          }}
        >
          Logout
        </button>
      </aside>
      <main className="content">
        <nav aria-label="Breadcrumb" className="breadcrumbs">
          {breadcrumbs.map((crumb, index) => (
            <span key={`${crumb.label}-${index}`} className="row" style={{ gap: '0.4rem' }}>
              {crumb.href ? <NavLink to={crumb.href}>{crumb.label}</NavLink> : <span>{crumb.label}</span>}
              {index < breadcrumbs.length - 1 ? <span className="muted">/</span> : null}
            </span>
          ))}
        </nav>
        <Outlet />
      </main>
    </div>
  );
}

export function buildBreadcrumbs(pathname: string): BreadcrumbItem[] {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) {
    return [{ label: 'Pipelines', href: '/pipelines' }];
  }

  const crumbs: BreadcrumbItem[] = [];
  let currentPath = '';

  segments.forEach((segment, index) => {
    currentPath += `/${segment}`;
    const isIdSegment = index > 0 && !SECTION_LABELS[segment];

    crumbs.push({
      label: isIdSegment ? `${segment.slice(0, 8)}…` : (SECTION_LABELS[segment] ?? segment),
      href: index === segments.length - 1 ? undefined : currentPath,
    });
  });

  return crumbs;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select';
}
