import { HTML_SOURCE } from '../config/defaults.js';
import type { ResolvedConfig } from '../config/types.js';
import { isTableElement } from './table.js';

/**
 * What an element can hold. Any element can be inserted; its kind only decides what goes inside it:
 * layout → other elements, text → text, interactive (links, buttons) and cells (td, th: in both lists) → both,
 * other → nothing, only props.
 */
export type ElementKind = 'layout' | 'text' | 'interactive' | 'cell' | 'other';

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
  if (matches(config.layoutComponents)) return matches(config.textComponents) ? 'cell' : 'layout';
  if (matches(config.interactiveComponents)) return 'interactive';
  if (matches(config.textComponents)) return 'text';
  return 'other';
}

export const holdsElements = (kind: ElementKind): boolean => kind === 'layout' || kind === 'interactive' || kind === 'cell';

export const holdsText = (kind: ElementKind): boolean => kind === 'text' || kind === 'interactive' || kind === 'cell';

/**
 * Whether an element takes layout options (flex): it holds other elements (a layout or interactive element,
 * or a component whose props declare children), and no table lays it out. The same rule for every command.
 */
export const takesLayout = (kind: ElementKind, tag: string, takesChildren = false): boolean => (kind === 'layout' || kind === 'interactive' || takesChildren) && !isTableElement(tag);

/** How an element lays out its children: interactive elements stay inline (a link in a line, buttons side by side). */
export const flexDisplay = (kind: ElementKind): 'flex' | 'inline-flex' => (kind === 'interactive' ? 'inline-flex' : 'flex');

/** Why an element takes no layout options, as the issue every command reports: `layout-not-allowed`. */
export function layoutRefusal(tag: string): { code: string; message: string; hint: string } {
  return isTableElement(tag)
    ? { code: 'layout-not-allowed', message: `<${tag}> is laid out by its table, so it takes no layout options.`, hint: 'Style it with --css instead, e.g. "padding: 8px; text-align: left".' }
    : {
        code: 'layout-not-allowed',
        message: `<${tag}> holds no elements, so it takes no layout options.`,
        hint: 'Layout options are for elements that hold others: layout elements (div, nav…), interactive ones (a, button…) and components that take children. Style it with --css instead.',
      };
}
