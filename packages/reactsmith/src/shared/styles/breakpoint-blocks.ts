import { escapeRegExp } from './regexp.js';

/** The end of the block opening at `open` (the index of its "{"): the index just after its matching "}". */
function blockEnd(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index++) {
    if (text[index] === '{') depth++;
    else if (text[index] === '}' && --depth === 0) return index + 1;
  }
  return text.length;
}

/** The breakpoints' @media blocks at the top of a style file: their name, and where each starts and ends. */
export function breakpointBlocks(text: string, breakpoints: Record<string, string>): { name: string; start: number; end: number }[] {
  const blocks: { name: string; start: number; end: number }[] = [];
  for (const [name, query] of Object.entries(breakpoints)) {
    const match = new RegExp(`(^|\\n)@media ${escapeRegExp(query)}\\s*\\{`).exec(text);
    if (!match) continue;
    const start = match.index + match[1]!.length;
    blocks.push({ name, start, end: blockEnd(text, match.index + match[0].length - 1) });
  }
  return blocks.sort((a, b) => a.start - b.start);
}

/** Updates the rules before the breakpoints' blocks, so a new base rule never lands after them and overrides them. */
export function updateBeforeBreakpoints(text: string, breakpoints: Record<string, string>, update: (head: string) => string): string {
  const first = breakpointBlocks(text, breakpoints)[0];
  if (!first) return update(text);
  const head = update(text.slice(0, first.start)).replace(/\s*$/, '');
  return `${head ? `${head}\n\n` : ''}${text.slice(first.start)}`;
}

/** Adds a rule after the base rules, before the breakpoints' blocks: a base rule after them would override them. */
export function appendBeforeBreakpoints(text: string, breakpoints: Record<string, string>, rule: string): string {
  return updateBeforeBreakpoints(text, breakpoints, (head) => (head.trim() ? `${head.replace(/\s*$/, '\n')}\n${rule}` : rule));
}
