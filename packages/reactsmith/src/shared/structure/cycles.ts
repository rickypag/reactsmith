/** Which features each feature imports: "dashboard" → {"users"}. */
export type FeatureGraph = Map<string, Set<string>>;

/** Groups of features that import each other directly or through other features (Tarjan's algorithm). */
function stronglyConnected(graph: FeatureGraph): string[][] {
  const index = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const groups: string[][] = [];
  let counter = 0;

  const visit = (node: string): void => {
    index.set(node, counter);
    lowLink.set(node, counter);
    counter++;
    stack.push(node);
    onStack.add(node);

    for (const next of graph.get(node) ?? []) {
      if (!index.has(next)) {
        visit(next);
        lowLink.set(node, Math.min(lowLink.get(node)!, lowLink.get(next)!));
      } else if (onStack.has(next)) {
        lowLink.set(node, Math.min(lowLink.get(node)!, index.get(next)!));
      }
    }

    if (lowLink.get(node) === index.get(node)) {
      const group: string[] = [];
      let member: string;
      do {
        member = stack.pop()!;
        onStack.delete(member);
        group.push(member);
      } while (member !== node);
      groups.push(group);
    }
  };

  for (const node of [...graph.keys()].sort()) {
    if (!index.has(node)) visit(node);
  }
  return groups;
}

/** A shortest loop from `start` back to itself, staying inside `group`. */
function loopFrom(start: string, group: Set<string>, graph: FeatureGraph): string[] {
  const previous = new Map<string, string>();
  const queue = [start];
  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const next of [...(graph.get(node) ?? [])].sort()) {
      if (!group.has(next)) continue;
      if (next === start) {
        const chain: string[] = [];
        for (let step = node; step !== start; step = previous.get(step)!) chain.unshift(step);
        return [start, ...chain, start];
      }
      if (previous.has(next)) continue;
      previous.set(next, node);
      queue.push(next);
    }
  }
  return [start, start];
}

/**
 * Loops between features, one per group of features that depend on each other,
 * e.g. [["auth", "dashboard", "auth"]]. Sorted for stable output.
 */
export function findFeatureCycles(graph: FeatureGraph): string[][] {
  return stronglyConnected(graph)
    .filter((group) => group.length > 1)
    .map((group) => {
      const members = [...group].sort();
      return loopFrom(members[0]!, new Set(members), graph);
    })
    .sort((a, b) => a[0]!.localeCompare(b[0]!));
}
