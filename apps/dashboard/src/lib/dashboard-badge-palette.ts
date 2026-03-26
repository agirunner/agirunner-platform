export const DASHBOARD_BADGE_BASE_CLASS_NAME =
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors';

export const DASHBOARD_BADGE_TOKENS = {
  error: {
    id: { light: 'B400', dark: 'B400' },
    className:
      'border-rose-200 bg-rose-100 text-rose-900 dark:border-rose-400 dark:bg-rose-400 dark:text-rose-950',
  },
  warning: {
    id: { light: 'B231', dark: 'B231' },
    className:
      'border-amber-200 bg-amber-100 text-amber-900 dark:border-amber-300 dark:bg-amber-300 dark:text-amber-950',
  },
  informationPrimary: {
    id: { light: 'B433', dark: 'B239' },
    className:
      'border-sky-200 bg-sky-100 text-sky-900 dark:border-sky-400 dark:bg-sky-400 dark:text-sky-950',
  },
  informationNeutral: {
    id: { light: 'B230', dark: 'B230' },
    className:
      'border-stone-300 bg-stone-100 text-stone-900 dark:border-zinc-300 dark:bg-zinc-300 dark:text-zinc-950',
  },
  informationSecondary: {
    id: { light: 'B438', dark: 'B437' },
    className:
      'border-indigo-200 bg-indigo-100 text-indigo-900 dark:border-slate-200 dark:bg-slate-200 dark:text-slate-950',
  },
  success: {
    id: { light: 'B237', dark: 'B237' },
    className:
      'border-emerald-200 bg-emerald-100 text-emerald-900 dark:border-green-400 dark:bg-green-400 dark:text-green-950',
  },
} as const;

export type DashboardBadgeToken = keyof typeof DASHBOARD_BADGE_TOKENS;
