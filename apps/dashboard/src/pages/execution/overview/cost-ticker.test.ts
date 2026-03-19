import { describe, it, expect } from 'vitest';
import { CostTicker, formatUsd, formatTokenCount } from './cost-ticker.js';

describe('CostTicker', () => {
  it('exports CostTicker as a function', () => {
    expect(typeof CostTicker).toBe('function');
  });
});

describe('formatUsd', () => {
  it('formats dollars', () => expect(formatUsd(14.2837)).toBe('$14.28'));
  it('formats zero', () => expect(formatUsd(0)).toBe('$0.00'));
  it('formats whole dollars', () => expect(formatUsd(5)).toBe('$5.00'));
  it('formats large amount', () => expect(formatUsd(1234.567)).toBe('$1234.57'));
  it('rounds to two decimal places', () => expect(formatUsd(0.999)).toBe('$1.00'));
});

describe('formatTokenCount', () => {
  it('formats thousands', () => expect(formatTokenCount(847000)).toBe('847K'));
  it('formats millions', () => expect(formatTokenCount(1500000)).toBe('1.5M'));
  it('formats small numbers', () => expect(formatTokenCount(500)).toBe('500'));
  it('formats exactly 1000', () => expect(formatTokenCount(1000)).toBe('1K'));
  it('formats exactly 1 million', () => expect(formatTokenCount(1000000)).toBe('1M'));
  it('formats 2.5 million', () => expect(formatTokenCount(2500000)).toBe('2.5M'));
  it('formats zero', () => expect(formatTokenCount(0)).toBe('0'));
});
