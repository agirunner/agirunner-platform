export const DASHBOARD_BADGE_BASE_CLASS_NAME =
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors';

export const DASHBOARD_BADGE_TOKENS = {
  error: {
    id: { light: 'B400', dark: 'B400' },
    className:
      'border-green-600 bg-green-600 text-white dark:border-rose-400 dark:bg-rose-400 dark:text-rose-950',
  },
  warning: {
    id: { light: 'B231', dark: 'B231' },
    className:
      'border-slate-700 bg-slate-700 text-white dark:border-amber-300 dark:bg-amber-300 dark:text-amber-950',
  },
  informationPrimary: {
    id: { light: 'B433', dark: 'B239' },
    className:
      'border-sky-600 bg-sky-600 text-white dark:border-sky-400 dark:bg-sky-400 dark:text-sky-950',
  },
  informationNeutral: {
    id: { light: 'B230', dark: 'B230' },
    className:
      'border-slate-700 bg-slate-700 text-white dark:border-zinc-300 dark:bg-zinc-300 dark:text-zinc-950',
  },
  informationSecondary: {
    id: { light: 'B438', dark: 'B437' },
    className:
      'border-blue-600 bg-blue-600 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-950',
  },
  success: {
    id: { light: 'B237', dark: 'B237' },
    className:
      'border-slate-700 bg-slate-700 text-white dark:border-green-400 dark:bg-green-400 dark:text-green-950',
  },
} as const;

export type DashboardBadgeToken = keyof typeof DASHBOARD_BADGE_TOKENS;
