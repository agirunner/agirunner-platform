import { describe, expect, it } from 'vitest';

import { canMoveDraftItem, moveDraftItem, spliceDraftItem } from './playbook-authoring-reorder.js';

describe('playbook authoring reorder helpers', () => {
  it('moves a draft item earlier without mutating the original list', () => {
    const items = ['inbox', 'doing', 'done'];

    expect(moveDraftItem(items, 1, 'earlier')).toEqual(['doing', 'inbox', 'done']);
    expect(items).toEqual(['inbox', 'doing', 'done']);
  });

  it('moves a draft item later without mutating the original list', () => {
    const items = ['plan', 'build', 'review'];

    expect(moveDraftItem(items, 1, 'later')).toEqual(['plan', 'review', 'build']);
    expect(items).toEqual(['plan', 'build', 'review']);
  });

  it('returns a copied list when the requested move is out of bounds', () => {
    const items = ['one', 'two'];
    const movedEarlier = moveDraftItem(items, 0, 'earlier');
    const movedLater = moveDraftItem(items, 1, 'later');

    expect(movedEarlier).toEqual(items);
    expect(movedEarlier).not.toBe(items);
    expect(movedLater).toEqual(items);
    expect(movedLater).not.toBe(items);
  });

  it('reports whether a move is available for the current position', () => {
    expect(canMoveDraftItem(0, 3, 'earlier')).toBe(false);
    expect(canMoveDraftItem(0, 3, 'later')).toBe(true);
    expect(canMoveDraftItem(2, 3, 'later')).toBe(false);
    expect(canMoveDraftItem(2, 3, 'earlier')).toBe(true);
    expect(canMoveDraftItem(-1, 3, 'later')).toBe(false);
  });

  it('splices a draft item from one index to another for drag-and-drop reorder', () => {
    const items = ['inbox', 'doing', 'review', 'done'];

    expect(spliceDraftItem(items, 0, 3)).toEqual(['doing', 'review', 'done', 'inbox']);
    expect(spliceDraftItem(items, 3, 0)).toEqual(['done', 'inbox', 'doing', 'review']);
    expect(spliceDraftItem(items, 1, 2)).toEqual(['inbox', 'review', 'doing', 'done']);
    expect(items).toEqual(['inbox', 'doing', 'review', 'done']);
  });

  it('returns a copied list when splice indices are equal or out of bounds', () => {
    const items = ['a', 'b', 'c'];

    expect(spliceDraftItem(items, 1, 1)).toEqual(items);
    expect(spliceDraftItem(items, 1, 1)).not.toBe(items);
    expect(spliceDraftItem(items, -1, 1)).toEqual(items);
    expect(spliceDraftItem(items, 0, 5)).toEqual(items);
  });
});
