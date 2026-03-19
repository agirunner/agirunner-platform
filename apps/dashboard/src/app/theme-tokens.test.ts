import { describe, it, expect } from 'vitest';
import {
  colors,
  roleColors,
  shadows,
  transitions,
  zIndex,
  spacing,
  typography,
  toCssVars,
} from './theme-tokens.js';

describe('theme-tokens', () => {
  it('defines all color tokens', () => {
    expect(colors.bgPrimary).toBe('#1a1a2e');
    expect(colors.bgSecondary).toBe('#252540');
    expect(colors.bgDeep).toBe('#0d0d1a');
    expect(colors.bgOverlay).toBe('rgba(0,0,0,0.7)');
    expect(colors.accentPrimary).toBe('#8b5cf6');
    expect(colors.accentPrimaryMuted).toBe('#8b5cf640');
    expect(colors.statusSuccess).toBe('#22c55e');
    expect(colors.statusWarning).toBe('#f59e0b');
    expect(colors.statusError).toBe('#ef4444');
    expect(colors.link).toBe('#3b82f6');
    expect(colors.textPrimary).toBe('#ffffff');
    expect(colors.textSecondary).toBe('#cccccc');
    expect(colors.textTertiary).toBe('#888888');
    expect(colors.textMuted).toBe('#666666');
    expect(colors.textFaint).toBe('#555555');
    expect(colors.borderDefault).toBe('#333333');
    expect(colors.borderFocus).toBe('#8b5cf6');
    expect(colors.borderSubtle).toBe('#444444');
  });

  it('defines all role colors', () => {
    expect(roleColors.developer).toBe('#8b5cf6');
    expect(roleColors.reviewer).toBe('#f59e0b');
    expect(roleColors.architect).toBe('#22c55e');
    expect(roleColors.qa).toBe('#3b82f6');
    expect(roleColors['product-manager']).toBe('#ec4899');
    expect(roleColors.orchestrator).toBe('#06b6d4');
  });

  it('defines shadow tokens', () => {
    expect(shadows.none).toBe('none');
    expect(shadows.panel).toBeDefined();
    expect(shadows.overlay).toBeDefined();
    expect(shadows.dropdown).toBeDefined();
  });

  it('defines transition tokens', () => {
    expect(transitions.fast).toBe('150ms ease-out');
    expect(transitions.normal).toBe('250ms ease-out');
    expect(transitions.slow).toBe('400ms ease-out');
  });

  it('defines z-index scale', () => {
    expect(zIndex.base).toBe(0);
    expect(zIndex.sticky).toBe(10);
    expect(zIndex.panel).toBe(20);
    expect(zIndex.resource).toBe(25);
    expect(zIndex.drawer).toBe(30);
    expect(zIndex.overlayBackdrop).toBe(40);
    expect(zIndex.overlay).toBe(50);
    expect(zIndex.palette).toBe(60);
    expect(zIndex.connection).toBe(70);
  });

  it('defines spacing scale', () => {
    expect(spacing).toEqual([4, 6, 8, 10, 12, 14, 16, 20, 24, 32]);
  });

  it('defines typography', () => {
    expect(typography.fontFamily).toContain('ui-monospace');
  });

  it('exports toCssVars producing correct custom properties', () => {
    const vars = toCssVars();
    expect(vars['--color-bg-primary']).toBe('#1a1a2e');
    expect(vars['--color-accent-primary']).toBe('#8b5cf6');
    expect(vars['--role-developer']).toBe('#8b5cf6');
    expect(vars['--shadow-panel']).toBeDefined();
    expect(vars['--transition-fast']).toBe('150ms ease-out');
    expect(vars['--z-panel']).toBe('20');
  });
});
