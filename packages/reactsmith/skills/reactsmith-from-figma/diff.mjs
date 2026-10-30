#!/usr/bin/env node
// Compares two exports of a Figma screen (the design the code was built from, and the design now) and turns what
// changed into ReactSmith commands for the file built from it. Only changes in the design count: what the code does
// differently on purpose (links, handlers, earlier decisions) is never touched.
//
//   node diff.mjs <node id> <file> [--dir .reactsmith/figma] [--tree tree.json] [--json]
//
// <file> is the view or component built from the screen; its elements come from "reactsmith tree --json" (or --tree).
// Layers are matched to elements by name ("h2: setupTitle" is #setupTitle). Changes that need a choice (new frames,
// unnamed layers, texts shown from props) are listed as decisions, not commands.

import { execSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORMAT = 'reactsmith-figma/1';

/** The exports holding a screen as a root, newest first. */
export async function versionsOf(dir, nodeId) {
  const files = (await readdir(dir).catch(() => [])).filter((file) => file.endsWith('.json'));
  const bundles = [];
  for (const file of files) {
    const bundle = JSON.parse(await readFile(path.join(dir, file), 'utf8'));
    if (bundle.format === FORMAT && bundle.roots?.includes(nodeId) && bundle.nodes?.[nodeId]) bundles.push(bundle);
  }
  return bundles.sort((a, b) => b.exportedAt.localeCompare(a.exportedAt));
}

const pascal = (text) => text.split(/[-_\s]+/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join('');

/** "h2: setupTitle" → { tag: "h2", name: "setupTitle" }; "install" → { name: "install" }; "Frame 12" or a component path → no name. */
function parseLayerName(name) {
  const match = /^([a-z][a-z0-9]*):\s*([a-z][A-Za-z0-9]*)$/.exec(name);
  if (match) return { tag: match[1], name: match[2] };
  return /^[a-z][A-Za-z0-9]*$/.test(name) ? { name } : {};
}

/** The component an instance shows: "CodeBlock" for "typography/CodeBlock", "SearchIcon" for the lucide icon "search". */
function componentOf(node, entry) {
  const component = entry.components?.[node.componentId];
  if (!component) return undefined;
  const set = component.componentSetId ? entry.componentSets?.[component.componentSetId] : undefined;
  const full = (set ?? component).name;
  if (/^Lucide /.test(component.description ?? '')) return `${pascal(full)}Icon`;
  return full.split('/').pop();
}

/** The value of a component property as a JSX attribute value. */
function propValue(property, entry) {
  if (property.type === 'INSTANCE_SWAP') {
    const name = componentOf({ componentId: property.value }, entry);
    return name ? `{${name}}` : undefined;
  }
  if (property.type === 'BOOLEAN') return `{${property.value}}`;
  // JSX strings have no escapes: a value with an apostrophe goes in double quotes, one with both quotes in braces.
  const value = String(property.value);
  if (!value.includes("'")) return `'${value}'`;
  return value.includes('"') ? `{${JSON.stringify(value)}}` : `"${value}"`;
}

const px = (value) => `${Math.round(value * 100) / 100}px`;
const ALIGN = { MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', SPACE_BETWEEN: 'space-between', STRETCH: 'stretch', BASELINE: 'baseline' };

/** The CSS a layer's own design sets, as the commands write it: layout, spacing, colors by variable, text. */
function cssOf(node, variables) {
  const css = {};
  const color = (paints) => {
    const paint = (paints ?? []).find((item) => item.visible !== false);
    const id = paint?.boundVariables?.color?.id;
    return id && variables[id] ? `var(--color-${variables[id].name.replace(/\//g, '-')})` : undefined;
  };
  if (node.layoutMode) {
    css['flex-direction'] = node.layoutMode === 'HORIZONTAL' ? 'row' : 'column';
    css.gap = px(node.itemSpacing ?? 0);
    css.padding = [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft].map((value) => px(value ?? 0)).join(' ');
    css['justify-content'] = ALIGN[node.primaryAxisAlignItems] ?? 'flex-start';
    css['align-items'] = ALIGN[node.counterAxisAlignItems] ?? 'flex-start';
  }
  if (node.type === 'TEXT') {
    // The project's two font families are tokens: a monospace font is --font-mono, any other the default.
    if (/mono/i.test(node.style?.fontFamily ?? '')) css['font-family'] = 'var(--font-mono)';
    if (node.style?.fontSize) css['font-size'] = px(node.style.fontSize);
    if (node.style?.fontWeight) css['font-weight'] = String(node.style.fontWeight);
    const lineHeight = node.style?.lineHeight;
    if (lineHeight?.unit === 'PIXELS') css['line-height'] = px(lineHeight.value);
    if (lineHeight?.unit === 'PERCENT') css['line-height'] = String(Math.round(lineHeight.value) / 100);
    const text = color(node.fills);
    if (text) css.color = text;
  } else {
    const background = color(node.fills);
    if (background) css.background = background;
  }
  const border = color(node.strokes);
  if (border) css['border-color'] = border;
  if (node.cornerRadius) css['border-radius'] = px(node.cornerRadius);
  return css;
}

/**
 * The layers of a screen's content as a tree of what the commands know: names, tags, texts, instance props and CSS.
 * A full screen's content is its frame "main"; instances are leaves (their insides are their component's).
 */
export function designTree(bundle, nodeId) {
  const entry = bundle.nodes[nodeId];
  const find = (node, name) => (node.name === name ? node : (node.children ?? []).map((child) => find(child, name)).find(Boolean));
  const content = find(entry.document, 'main') ?? entry.document;
  const variables = bundle.variables ?? {};
  const walk = (node) => {
    const { tag, name } = parseLayerName(node.name);
    const layer = { figmaId: node.id, figmaName: node.name, name, css: cssOf(node, variables), children: [] };
    if (node.type === 'TEXT') Object.assign(layer, { kind: 'text', tag: tag ?? 'span', text: node.characters, bound: Boolean(node.componentPropertyReferences?.characters) });
    else if (node.type === 'INSTANCE') {
      const props = {};
      for (const [key, property] of Object.entries(node.componentProperties ?? {})) {
        const value = propValue(property, entry);
        if (value !== undefined) props[key.split('#')[0]] = value;
      }
      Object.assign(layer, { kind: 'instance', tag: componentOf(node, entry) ?? node.name, props });
    } else {
      Object.assign(layer, { kind: 'frame', tag: tag ?? 'div' });
      layer.children = (node.children ?? []).filter((child) => child.visible !== false).map(walk);
    }
    return layer;
  };
  return { ...walk(content), name: 'root' };
}

/** Every named layer, with its parent's name and its place: name → { layer, parent, index }. */
function index(tree) {
  const byName = new Map();
  const unnamed = [];
  const visit = (layer, parent) => {
    layer.children.forEach((child, position) => {
      if (child.name) byName.set(child.name, { layer: child, parent: parent.name, siblings: parent.children.filter((sibling) => sibling.name).map((sibling) => sibling.name), position });
      else unnamed.push({ layer: child, parent: parent.name });
      visit(child, child.name ? child : parent);
    });
  };
  visit(tree, tree);
  return { byName, unnamed };
}

/** The code's elements by name (style), from "reactsmith tree --json": name → { id, element, parent }. */
function codeIndex(description) {
  const byName = new Map();
  const visit = (element, parent) => {
    if (element.name) byName.set(element.name, { id: element.id, element, parent });
    for (const child of element.children ?? []) visit(child, element.name ? element.name : parent);
  };
  for (const root of description.roots) visit(root, undefined);
  return byName;
}

/** The siblings to move so `current` follows `wanted`: everything outside a longest run already in order. */
export function outOfOrder(current, wanted) {
  const seq = current.filter((name) => wanted.includes(name)).map((name) => wanted.indexOf(name));
  // Longest increasing subsequence of the wanted positions: those stay, the others move.
  const tails = [];
  const previous = new Array(seq.length);
  const at = [];
  seq.forEach((value, i) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]] < value) lo = mid + 1;
      else hi = mid;
    }
    previous[i] = lo > 0 ? tails[lo - 1] : -1;
    tails[lo] = i;
    at.push(lo);
  });
  const keep = new Set();
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = previous[i]) keep.add(wanted[seq[i]]);
  return wanted.filter((name) => current.includes(name) && !keep.has(name));
}

const quote = (text) => `"${String(text).replace(/(["\\$`])/g, '\\$1')}"`;

/**
 * The commands that bring the code from the old design to the new one, and the changes that need a decision.
 * `code` is the file's description from "reactsmith tree --json".
 */
export function diffDesigns(oldTree, newTree, code) {
  const before = index(oldTree);
  const after = index(newTree);
  const elements = codeIndex(code);
  const rootId = code.roots[0].id;
  const fileId = rootId.slice(0, rootId.indexOf('#'));
  // A name used once in a file is its element's id, also for elements this diff inserts.
  const idOf = (name) => (name === 'root' ? rootId : (elements.get(name)?.id ?? `${fileId}#${name}`));
  const exists = (name) => name === 'root' || elements.has(name);
  const commands = [];
  const decisions = [];
  const add = (why, command) => commands.push({ why, command: `npx reactsmith ${command}` });

  // Removed from the design: removed from the code, when it is there.
  for (const [name] of before.byName) {
    if (after.byName.has(name)) continue;
    if (elements.has(name)) add(`#${name}: removed in the design`, `element remove ${quote(idOf(name))}`);
  }

  // New in the design: a text or an instance is inserted after its previous named sibling; anything else is a decision.
  for (const [name, { layer, parent, siblings }] of after.byName) {
    if (before.byName.has(name)) continue;
    if (elements.has(name)) continue;
    const parentId = exists(parent) ? idOf(parent) : undefined;
    const previous = siblings.slice(0, siblings.indexOf(name)).reverse().find((sibling) => elements.has(sibling) || !before.byName.has(sibling));
    const where = previous ? `--into ${quote(idOf(previous))} --position after` : `--into ${quote(parentId)} --position first`;
    if (!parentId) decisions.push(`#${name}: new in the design, in "${parent}", which the code doesn't have`);
    else if (layer.kind === 'text' && !layer.bound) {
      add(`#${name}: new in the design`, `element insert ${layer.tag} ${where} --text ${quote(layer.text)} --name ${name}`);
      const css = Object.entries(layer.css).map(([property, value]) => `${property}: ${value}`).join('; ');
      if (css) add(`#${name}: its style`, `style update ${quote(idOf(name))} --css ${quote(css)}`);
    } else if (layer.kind === 'instance') {
      const props = Object.entries(layer.props).map(([prop, value]) => `${prop}=${value}`).join(' ');
      add(`#${name}: new in the design, a ${layer.tag}`, `element insert ${layer.tag} ${where}${props ? ` --props ${quote(props)}` : ''} --name ${name}`);
    } else decisions.push(`#${name}: a new ${layer.kind === 'frame' ? `frame (${layer.figmaName})` : 'text shown from a property'} in the design: build it as when building a screen`);
  }

  // Moved into another frame, or reordered among its siblings.
  const parents = new Set([...after.byName.values()].map((entry) => entry.parent));
  for (const parent of parents) {
    const wantedNow = [...after.byName.entries()].filter(([, entry]) => entry.parent === parent).sort((a, b) => a[1].position - b[1].position).map(([name]) => name);
    const wantedBefore = [...before.byName.entries()].filter(([, entry]) => entry.parent === parent).sort((a, b) => a[1].position - b[1].position).map(([name]) => name);
    for (const name of wantedNow) {
      const old = before.byName.get(name);
      if (old && old.parent !== parent && elements.has(name) && exists(parent)) add(`#${name}: moved into "${parent}" in the design`, `element move ${quote(idOf(name))} --into ${quote(idOf(parent))}`);
    }
    // Only a change of order in the design moves anything: the code's own order is otherwise left as it is.
    const common = wantedNow.filter((name) => wantedBefore.includes(name));
    const changed = common.join() !== wantedBefore.filter((name) => wantedNow.includes(name)).join();
    if (!changed) continue;
    const parentElement = parent === 'root' ? code.roots[0] : elements.get(parent)?.element;
    const current = (parentElement?.children ?? []).filter((element) => element.name).map((element) => element.name);
    for (const name of outOfOrder(current, wantedNow.filter((candidate) => current.includes(candidate)))) {
      const position = wantedNow.indexOf(name);
      const previous = wantedNow.slice(0, position).reverse().find((sibling) => current.includes(sibling));
      const next = wantedNow.slice(position + 1).find((sibling) => current.includes(sibling));
      if (previous) add(`#${name}: after #${previous} in the design`, `element move ${quote(idOf(name))} --into ${quote(idOf(previous))} --position after`);
      else if (next) add(`#${name}: before #${next} in the design`, `element move ${quote(idOf(name))} --into ${quote(idOf(next))} --position before`);
    }
  }

  // Texts, instance values and styles that changed in the design.
  for (const [name, { layer }] of after.byName) {
    const old = before.byName.get(name)?.layer;
    const element = elements.get(name);
    if (!old || !element) continue;
    // What the code already has is not changed again: running the diff twice is harmless.
    if (layer.kind === 'text' && old.text !== layer.text && element.element.text !== layer.text) {
      if (layer.bound || /[{}]/.test(element.element.text ?? '')) decisions.push(`#${name}: its text changed in the design ("${old.text}" → "${layer.text}"), but the code shows a value: change it where the value comes from`);
      else add(`#${name}: "${old.text}" → "${layer.text}"`, `element update ${quote(element.id)} --text ${quote(layer.text)}`);
    }
    if (layer.kind === 'instance') {
      const written = (value) => value.replace(/^'(.*)'$|^"(.*)"$/s, '$1$2');
      const changed = Object.entries(layer.props).filter(([prop, value]) => old.props?.[prop] !== value && element.element.props?.[prop] !== written(value));
      if (changed.length) add(`#${name}: ${changed.map(([prop, value]) => `${prop} ${old.props?.[prop] ?? '(none)'} → ${value}`).join(', ')}`, `element update ${quote(element.id)} --props ${quote(changed.map(([prop, value]) => `${prop}=${value}`).join(' '))}`);
    }
    const css = Object.entries(layer.css).filter(([property, value]) => old.css[property] !== value && element.element.style?.[property] !== value);
    if (css.length) add(`#${name}: style ${css.map(([property, value]) => `${property} ${old.css[property] ?? '(none)'} → ${value}`).join(', ')}`, `style update ${quote(element.id)} --css ${quote(css.map(([property, value]) => `${property}: ${value}`).join('; '))}`);
  }

  for (const { layer, parent } of after.unnamed) {
    const was = before.unnamed.find((candidate) => candidate.layer.figmaId === layer.figmaId);
    const changed = !was || JSON.stringify(was.layer) !== JSON.stringify(layer);
    if (changed) decisions.push(`"${layer.figmaName}" in "${parent}": ${was ? 'changed' : 'new'}, without a name to find it in the code: name the layer in Figma, or change it by hand`);
  }
  return { commands, decisions };
}

function codeTree(file, treeFile) {
  if (treeFile) return readFile(treeFile, 'utf8').then((text) => JSON.parse(text));
  const output = execSync(`npx reactsmith tree ${JSON.stringify(file)} --json`, { encoding: 'utf8' });
  return Promise.resolve(JSON.parse(output).data);
}

export async function main(argv) {
  const option = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const [nodeArg, file] = argv.filter((arg, i) => !arg.startsWith('--') && !['--dir', '--tree'].includes(argv[i - 1]));
  const nodeId = nodeArg?.replace('-', ':');
  if (!nodeId || !file) throw new Error('Pass the screen\'s node id and the file built from it, e.g. node diff.mjs 440:242 src/features/docs/views/InstallationView/InstallationView.tsx');
  const dir = option('--dir') ?? '.reactsmith/figma';
  const [newest, previous] = await versionsOf(dir, nodeId);
  if (!newest) throw new Error(`No export of ${nodeId} in ${dir}: export the screen first.`);
  if (!previous) throw new Error(`Only one export of ${nodeId} in ${dir}: there is nothing to compare it with. Compare the design with the code by reading both (updating.md), then keep this export as the base of the next update.`);
  const code = await codeTree(file, option('--tree'));
  const result = diffDesigns(designTree(previous, nodeId), designTree(newest, nodeId), code);
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ from: previous.exportedAt, to: newest.exportedAt, ...result }, null, 2));
    return result;
  }
  console.log(`Changes in the design of ${nodeId}, ${previous.exportedAt} → ${newest.exportedAt}, for ${code.file}:\n`);
  for (const { why, command } of result.commands) console.log(`- ${why}\n  ${command}`);
  if (result.commands.length === 0) console.log('- No change to apply.');
  if (result.decisions.length) console.log(`\nDecisions:\n${result.decisions.map((decision) => `- ${decision}`).join('\n')}`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`diff.mjs: ${error.message}`);
    process.exit(1);
  });
}
