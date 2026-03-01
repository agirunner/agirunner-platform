import { NavLink, Outlet, useNavigate } from 'react-router-dom';

import { dashboardApi } from '../lib/api.js';
import { readSession } from '../lib/session.js';

interface LayoutProps {
  onToggleTheme: () => void;
}

export function DashboardLayout({ onToggleTheme }: LayoutProps): JSX.Element {
  const navigate = useNavigate();
  const session = readSession();

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
        <nav>
          <NavLink to="/pipelines">Pipelines</NavLink>
          <NavLink to="/workers">Workers</NavLink>
          <NavLink to="/metrics">System Metrics</NavLink>
        </nav>
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
        <Outlet />
      </main>
    </div>
  );
}
