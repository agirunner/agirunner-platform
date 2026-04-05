import { useEffect, useState } from 'react';
import type { ElementType } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Bot,
  ChevronRight,
  Cog,
  Container,
  FileText,
  FolderOpen,
  Gauge,
  Key,
  LayoutDashboard,
  Link2,
  Package,
  ScrollText,
  Search,
  Send,
  Server,
  Settings2,
  Shield,
  Users,
  Wrench,
  Zap,
} from 'lucide-react';

import { cn } from '../../lib/utils.js';
import type { CommandPaletteItem } from './layout-search.js';

export interface NavItem {
  label: string;
  href: string;
  icon: ElementType;
  keywords?: string[];
}

export interface NavSection {
  label: string;
  icon: ElementType;
  items: NavItem[];
}

const WORKFLOWS_NAV_HREF = '/workflows';
const DESKTOP_SIDEBAR_COLLAPSED_STORAGE_KEY = 'agirunner.desktop-sidebar-collapsed';

export const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Mission Control',
    icon: Gauge,
    items: [
      {
        label: 'Workflows',
        href: WORKFLOWS_NAV_HREF,
        icon: LayoutDashboard,
        keywords: [
          'live operations',
          'workflow canvas',
          'attention rail',
          'action queue',
          'workflows',
          'tasks',
          'recent',
          'history',
        ],
      },
    ],
  },
  {
    label: 'Work Design',
    icon: FolderOpen,
    items: [
      { label: 'Playbooks', href: '/design/playbooks', icon: FileText },
      { label: 'Workspaces', href: '/design/workspaces', icon: FolderOpen },
      {
        label: 'Specialists',
        href: '/design/specialists',
        icon: Users,
        keywords: ['specialist', 'agent roles', 'role definitions'],
      },
      {
        label: 'Skills',
        href: '/design/specialists/skills',
        icon: ScrollText,
        keywords: ['specialist skills', 'shared skills', 'skill library'],
      },
    ],
  },
  {
    label: 'Platform',
    icon: Cog,
    items: [
      {
        label: 'Models',
        href: '/platform/models',
        icon: Cog,
        keywords: ['models', 'routing', 'model routing', 'llm'],
      },
      { label: 'Instructions', href: '/platform/instructions', icon: ScrollText },
      {
        label: 'Orchestrator',
        href: '/platform/orchestrator',
        icon: Bot,
        keywords: ['orchestrator', 'prompt', 'model routing', 'pool posture'],
      },
      {
        label: 'Environments',
        href: '/platform/environments',
        icon: Container,
        keywords: ['execution environment', 'execution environments', 'byoi', 'container image'],
      },
      { label: 'Tools', href: '/platform/tools', icon: Wrench },
    ],
  },
  {
    label: 'Integrations',
    icon: Link2,
    items: [
      { label: 'MCP Servers', href: '/integrations/mcp-servers', icon: Link2 },
      { label: 'Triggers (soon)', href: '/integrations/triggers', icon: Zap },
      { label: 'Webhooks (soon)', href: '/integrations/webhooks', icon: Send },
    ],
  },
  {
    label: 'Diagnostics',
    icon: FileText,
    items: [
      { label: 'Live Logs', href: '/diagnostics/live-logs', icon: Search },
      { label: 'Live Containers', href: '/diagnostics/live-containers', icon: Package },
    ],
  },
  {
    label: 'Admin',
    icon: Shield,
    items: [
      { label: 'API Keys', href: '/admin/api-keys', icon: Key },
      { label: 'General Settings', href: '/admin/general-settings', icon: Settings2 },
      {
        label: 'Agentic Settings',
        href: '/admin/agentic-settings',
        icon: Server,
        keywords: ['specialist agent', 'specialist agents', 'runtime', 'runtimes'],
      },
      {
        label: 'Platform settings',
        href: '/admin/platform-settings',
        icon: Settings2,
        keywords: ['operations', 'timing', 'supervision', 'fleet', 'activation'],
      },
    ],
  },
];

export const COMMAND_PALETTE_QUICK_LINKS: CommandPaletteItem[] = NAV_SECTIONS.flatMap((section) =>
  section.items.map((item) => ({
    id: `nav:${item.href}`,
    href: item.href,
    label: item.label,
    meta: section.label,
    kind: 'navigation',
    ...(item.keywords?.length ? { keywords: item.keywords } : {}),
  })),
);

export const FOCUS_RING_CLASSES =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

export const ICON_BUTTON_CLASSES = cn(
  'rounded-md p-1.5 text-muted transition-colors hover:bg-border/50 hover:text-foreground',
  FOCUS_RING_CLASSES,
);

export const SIDEBAR_SHELL_CLASSES =
  'border-r border-stone-200/90 bg-stone-100/95 shadow-[inset_-1px_0_0_rgba(255,255,255,0.72)] dark:border-slate-800 dark:bg-slate-950 dark:shadow-none';

const SIDEBAR_SECTION_BUTTON_CLASSES =
  'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-[background-color,color,box-shadow]';

const SIDEBAR_SECTION_ACTIVE_CLASSES =
  'bg-white/92 text-slate-950 shadow-sm ring-1 ring-stone-300/90 dark:bg-slate-900/80 dark:text-slate-100 dark:ring-slate-700';

const SIDEBAR_SECTION_INACTIVE_CLASSES =
  'text-slate-700 hover:bg-stone-50/80 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-900/70 dark:hover:text-slate-100';

export const SIDEBAR_SECTION_GROUP_CLASSES =
  'mt-1 grid gap-1 px-1';

const SIDEBAR_ACTIVE_ITEM_CLASSES =
  'bg-sky-100 text-sky-950 shadow-sm ring-1 ring-sky-200/90 dark:bg-white dark:text-slate-950 dark:font-semibold';

const SIDEBAR_INACTIVE_ITEM_CLASSES =
  'text-slate-700 hover:bg-stone-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800/90 dark:hover:text-slate-100';

function readSidebarItemStateClasses(isActive: boolean): string {
  if (!isActive) {
    return SIDEBAR_INACTIVE_ITEM_CLASSES;
  }
  return SIDEBAR_ACTIVE_ITEM_CLASSES;
}

export function findNavigationItemByHref(href: string): NavItem | null {
  for (const section of NAV_SECTIONS) {
    const match = section.items.find((item) => item.href === href);
    if (match) {
      return match;
    }
  }
  return null;
}

export function buildDesktopSidebarStorageKey(tenantId: string | null): string {
  return tenantId
    ? `${DESKTOP_SIDEBAR_COLLAPSED_STORAGE_KEY}.${tenantId}`
    : DESKTOP_SIDEBAR_COLLAPSED_STORAGE_KEY;
}

export function readDesktopSidebarCollapsedState(
  storage: Pick<Storage, 'getItem'> | undefined,
  tenantId: string | null,
): boolean {
  if (!storage) {
    return false;
  }

  const stored = storage.getItem(buildDesktopSidebarStorageKey(tenantId));
  if (stored === 'true') {
    return true;
  }
  if (stored === 'false') {
    return false;
  }
  return false;
}

export function NavSectionGroup(props: {
  section: NavSection;
  isActive: boolean;
  isSidebarCollapsed: boolean;
}): JSX.Element {
  const [expanded, setExpanded] = useState(true);
  const rendersAsSingleItem =
    props.section.items.length === 1 && props.section.items[0]?.label === props.section.label;
  const singleItem = rendersAsSingleItem ? props.section.items[0] : null;

  useEffect(() => {
    if (props.isActive) {
      setExpanded(true);
    }
  }, [props.isActive]);
  const Icon = props.section.icon;

  if (props.isSidebarCollapsed && rendersAsSingleItem && singleItem) {
    return (
      <div className="mb-3">
        <div className="sr-only">{props.section.label}</div>
        <NavLink
          to={singleItem.href}
          end
          title={singleItem.label}
          aria-label={singleItem.label}
          className={({ isActive: active }) =>
            cn(
              'flex items-center justify-center rounded-lg px-0 py-2.5 transition-[background-color,color,box-shadow]',
              FOCUS_RING_CLASSES,
              readSidebarItemStateClasses(active),
            )
          }
        >
          <singleItem.icon size={15} />
          <span className="sr-only">{singleItem.label}</span>
        </NavLink>
      </div>
    );
  }

  if (props.isSidebarCollapsed) {
    return (
      <div className="mb-3">
        <div className="sr-only">{props.section.label}</div>
        <div
          data-sidebar-section-group="true"
          className={cn(SIDEBAR_SECTION_GROUP_CLASSES, 'py-1.5')}
        >
          {props.section.items.map((item) => (
            <NavLink
              key={item.href}
              to={item.href}
              end
              title={item.label}
              aria-label={item.label}
              className={({ isActive: active }) =>
                cn(
                  'flex items-center justify-center rounded-lg px-0 py-2.5 transition-[background-color,color,box-shadow]',
                  FOCUS_RING_CLASSES,
                  readSidebarItemStateClasses(active),
                )
              }
            >
              <item.icon size={15} />
              <span className="sr-only">{item.label}</span>
            </NavLink>
          ))}
        </div>
      </div>
    );
  }

  if (rendersAsSingleItem && singleItem) {
    return (
      <div className="mb-1">
        <NavLink
          to={singleItem.href}
          end
          title={singleItem.label}
          aria-label={singleItem.label}
          className={({ isActive: active }) =>
            cn(
              'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-[background-color,color,box-shadow]',
              FOCUS_RING_CLASSES,
              readSidebarItemStateClasses(active),
            )
          }
        >
          <singleItem.icon size={13} />
          {singleItem.label}
        </NavLink>
      </div>
    );
  }

  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className={cn(
          SIDEBAR_SECTION_BUTTON_CLASSES,
          FOCUS_RING_CLASSES,
          props.isActive ? SIDEBAR_SECTION_ACTIVE_CLASSES : SIDEBAR_SECTION_INACTIVE_CLASSES,
        )}
      >
        <Icon size={15} />
        <span className="flex-1 text-left">{props.section.label}</span>
        <ChevronRight size={14} className={cn('transition-transform', expanded && 'rotate-90')} />
      </button>
      {expanded ? (
        <div data-sidebar-section-group="true" className={SIDEBAR_SECTION_GROUP_CLASSES}>
          {props.section.items.map((item) => (
            <NavLink
              key={item.href}
              to={item.href}
              end
              title={item.label}
              aria-label={item.label}
              className={({ isActive: active }) =>
                cn(
                  'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-[background-color,color,box-shadow]',
                  FOCUS_RING_CLASSES,
                  readSidebarItemStateClasses(active),
                )
              }
            >
              <item.icon size={13} />
              {item.label}
            </NavLink>
          ))}
        </div>
      ) : null}
    </div>
  );
}
