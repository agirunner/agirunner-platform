export const colors = {
  bgPrimary: '#1a1a2e',
  bgSecondary: '#252540',
  bgDeep: '#0d0d1a',
  bgOverlay: 'rgba(0,0,0,0.7)',
  accentPrimary: '#8b5cf6',
  accentPrimaryMuted: '#8b5cf640',
  statusSuccess: '#22c55e',
  statusWarning: '#f59e0b',
  statusError: '#ef4444',
  link: '#3b82f6',
  textPrimary: '#ffffff',
  textSecondary: '#cccccc',
  textTertiary: '#888888',
  textMuted: '#666666',
  textFaint: '#555555',
  borderDefault: '#333333',
  borderFocus: '#8b5cf6',
  borderSubtle: '#444444',
} as const;

export const roleColors = {
  developer: '#8b5cf6',
  reviewer: '#f59e0b',
  architect: '#22c55e',
  qa: '#3b82f6',
  'product-manager': '#ec4899',
  orchestrator: '#06b6d4',
} as const;

export type RoleName = keyof typeof roleColors;

export const shadows = {
  none: 'none',
  panel: '0 4px 24px rgba(0,0,0,0.4)',
  overlay: '0 8px 32px rgba(139,92,246,0.3)',
  dropdown: '0 4px 12px rgba(0,0,0,0.5)',
} as const;

export const transitions = {
  fast: '150ms ease-out',
  normal: '250ms ease-out',
  slow: '400ms ease-out',
} as const;

export const zIndex = {
  base: 0,
  sticky: 10,
  panel: 20,
  resource: 25,
  drawer: 30,
  overlayBackdrop: 40,
  overlay: 50,
  palette: 60,
  connection: 70,
} as const;

export const spacing = [4, 6, 8, 10, 12, 14, 16, 20, 24, 32] as const;

export const typography = {
  fontFamily:
    "ui-monospace, 'SF Mono', 'Cascadia Code', 'Fira Code', Menlo, Monaco, Consolas, monospace",
  heading: { page: '13px', section: '11px', subsection: '10px' },
  body: '11px',
  label: '9px',
  code: '10px',
} as const;

export function toCssVars(): Record<string, string> {
  const vars: Record<string, string> = {};

  for (const [key, value] of Object.entries(colors)) {
    const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
    vars[`--color-${cssKey}`] = value;
  }

  for (const [key, value] of Object.entries(roleColors)) {
    vars[`--role-${key}`] = value;
  }

  for (const [key, value] of Object.entries(shadows)) {
    vars[`--shadow-${key}`] = value;
  }

  for (const [key, value] of Object.entries(transitions)) {
    vars[`--transition-${key}`] = value;
  }

  for (const [key, value] of Object.entries(zIndex)) {
    const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
    vars[`--z-${cssKey}`] = String(value);
  }

  vars['--font-family'] = typography.fontFamily;

  return vars;
}
