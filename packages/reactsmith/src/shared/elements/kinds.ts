import { HTML_SOURCE } from '../config/defaults.js';
import type { ResolvedConfig } from '../config/types.js';

/**
 * What an element can hold. Any element can be inserted; its kind only decides what goes inside it:
 * layout → other elements, text → text (and icons), interactive (links, buttons) → both, other → nothing, only props.
 */
export type ElementKind = 'layout' | 'text' | 'interactive' | 'other';

/** An HTML tag ("div", "img") or a component name ("NavLink", "Card"). */
export function isHtmlTag(name: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(name);
}

export function isComponentName(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(name);
}

/**
 * The kind of an element, from the config's element maps. `source` is where a component is imported from:
 * a package ("react-router") or, for a component of the project, its import path with the alias ("@/components/layout/Stack").
 */
export function elementKind(config: ResolvedConfig, name: string, source?: string): ElementKind {
  const matches = (map: Record<string, readonly string[]>) => {
    if (isHtmlTag(name)) return (map[HTML_SOURCE] ?? []).includes(name);
    if (source === undefined) return false;
    return Object.entries(map).some(([from, names]) => from !== HTML_SOURCE && (source === from || source.startsWith(`${from}/`)) && names.includes(name));
  };
  if (matches(config.layoutComponents)) return 'layout';
  if (matches(config.interactiveComponents)) return 'interactive';
  if (matches(config.textComponents)) return 'text';
  return 'other';
}

export const holdsElements = (kind: ElementKind): boolean => kind === 'layout' || kind === 'interactive';

export const holdsText = (kind: ElementKind): boolean => kind === 'text' || kind === 'interactive';
