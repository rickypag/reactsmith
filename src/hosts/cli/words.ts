/** A line of a batch, split into words as a shell would, with its line number in the file. */
export interface BatchLine {
  line: number;
  text: string;
  words: string[];
}

export class BatchSyntaxError extends Error {
  constructor(
    readonly line: number,
    message: string,
  ) {
    super(message);
  }
}

const VARIABLE = /^([A-Za-z_][A-Za-z0-9_]*)=/;

/**
 * Splits a batch into its commands, the way a shell reads a script: words separated by spaces, '…' taken as is,
 * "…" with \" \\ \$ escapes, a \ at the end of a line continuing it, # starting a comment. A NAME=value line sets
 * a variable that later lines use as $NAME or ${NAME}, outside single quotes.
 */
export function splitBatch(text: string): BatchLine[] {
  const physical = text.replace(/\r\n?/g, '\n').split('\n');
  const variables = new Map<string, string>();
  const lines: BatchLine[] = [];
  for (let index = 0; index < physical.length; index++) {
    const start = index + 1;
    let logical = physical[index]!;
    // A line ending in an odd number of backslashes continues on the next one.
    while (/(^|[^\\])(\\\\)*\\$/.test(logical) && index + 1 < physical.length) logical = `${logical.slice(0, -1)} ${physical[++index]}`;
    const words = splitWords(logical, start, variables);
    if (words.length === 0) continue;
    const assignment = words.length === 1 ? VARIABLE.exec(logical.trim()) : null;
    if (assignment) {
      variables.set(assignment[1]!, words[0]!.slice(assignment[1]!.length + 1));
      continue;
    }
    lines.push({ line: start, text: logical.trim(), words });
  }
  return lines;
}

function splitWords(text: string, line: number, variables: Map<string, string>): string[] {
  const words: string[] = [];
  let word = '';
  let inWord = false;
  let quote: "'" | '"' | undefined;

  const expand = (at: number): number => {
    const braced = text[at + 1] === '{';
    const match = (braced ? /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}/ : /^\$([A-Za-z_][A-Za-z0-9_]*)/).exec(text.slice(at));
    if (!match) {
      word += '$';
      return at;
    }
    const value = variables.get(match[1]!);
    if (value === undefined) throw new BatchSyntaxError(line, `"$${match[1]}" is not set: set it on a line of its own before, e.g. ${match[1]}=src/app/components/TopBar/TopBar.tsx`);
    word += value;
    return at + match[0].length - 1;
  };

  for (let at = 0; at < text.length; at++) {
    const char = text[at]!;
    if (quote === "'") {
      if (char === "'") quote = undefined;
      else word += char;
      continue;
    }
    if (quote === '"') {
      if (char === '"') quote = undefined;
      else if (char === '\\' && '"\\$`'.includes(text[at + 1] ?? '')) word += text[++at];
      else if (char === '$') at = expand(at);
      else word += char;
      continue;
    }
    if (/\s/.test(char)) {
      if (inWord) words.push(word);
      word = '';
      inWord = false;
      continue;
    }
    if (char === '#' && !inWord) break;
    inWord = true;
    if (char === "'" || char === '"') quote = char;
    else if (char === '\\') word += text[++at] ?? '';
    else if (char === '$') at = expand(at);
    else word += char;
  }
  if (quote) throw new BatchSyntaxError(line, `A ${quote === '"' ? 'double' : 'single'} quote is not closed.`);
  if (inWord) words.push(word);
  return words;
}
