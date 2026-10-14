import { describe, expect, it } from 'vitest';
import { findFeatureCycles, type FeatureGraph } from '../../src/shared/structure/cycles.js';

function graph(edges: Record<string, string[]>): FeatureGraph {
  return new Map(Object.entries(edges).map(([from, to]) => [from, new Set(to)]));
}

describe('findFeatureCycles', () => {
  it('finds nothing in one-way imports', () => {
    expect(findFeatureCycles(graph({ dashboard: ['users'], users: ['auth'] }))).toEqual([]);
  });

  it('finds a direct loop', () => {
    expect(findFeatureCycles(graph({ users: ['dashboard'], dashboard: ['users'] }))).toEqual([['dashboard', 'users', 'dashboard']]);
  });

  it('finds a longer loop and reports its shortest path', () => {
    expect(findFeatureCycles(graph({ a: ['b'], b: ['c'], c: ['a'], d: ['a'] }))).toEqual([['a', 'b', 'c', 'a']]);
  });

  it('reports separate loops separately', () => {
    const cycles = findFeatureCycles(graph({ a: ['b'], b: ['a'], x: ['y'], y: ['x'], b2: ['x'] }));
    expect(cycles).toEqual([
      ['a', 'b', 'a'],
      ['x', 'y', 'x'],
    ]);
  });
});
