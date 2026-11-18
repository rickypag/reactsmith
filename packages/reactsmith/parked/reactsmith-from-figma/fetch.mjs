#!/usr/bin/env node
// Saves Figma frames and components for ReactSmith, with as few API calls as possible: all the given screens in
// one call, then the definitions of the components they use. The result has the same format as the ReactSmith
// export plugin, which needs no API at all.
//
//   FIGMA_TOKEN=… node fetch.mjs <figma link or node id>… [--refresh] [--out .reactsmith/figma]
//
// Node ids are "420:559" or "420-559"; without a link, the file comes from "design.figma" in reactsmith.config.json.
// Screens already saved are not fetched again unless --refresh. On a rate limit, it stops: it never retries.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORMAT = 'reactsmith-figma/1';
const API = 'https://api.figma.com/v1';

/** "https://www.figma.com/design/KEY/Name?node-id=420-559" → { fileKey: "KEY", nodeId: "420:559" }; "420-559" → { nodeId }. */
export function parseTarget(text) {
  const link = /figma\.com\/(?:design|file)\/([A-Za-z0-9]+)/.exec(text);
  const node = link ? /[?&]node-id=([\d]+[-:][\d]+)/.exec(text)?.[1] : /^(\d+[-:]\d+)$/.exec(text.trim())?.[1];
  return { fileKey: link?.[1], nodeId: node?.replace('-', ':') };
}

/** The local components the nodes use that have no definition yet: the set of a variant, or the component itself. */
export function missingDefinitions(entries, definitions) {
  const ids = new Set();
  for (const entry of entries) {
    for (const [id, component] of Object.entries(entry.components ?? {})) {
      if (component.remote) continue;
      const definition = component.componentSetId ?? id;
      if (!(definition in definitions)) ids.add(definition);
    }
  }
  return [...ids];
}

/** A file-safe name from the screens' names: "Introduction-430-248" → "introduction-430-248". */
export function bundleName(names) {
  return names.join('-').replace(/[^\w-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'figma';
}

export class RateLimited extends Error {}

async function getNodes(token, fileKey, ids, counter) {
  counter.calls++;
  const response = await fetch(`${API}/files/${fileKey}/nodes?ids=${encodeURIComponent(ids.join(','))}`, { headers: { 'X-Figma-Token': token } });
  if (response.status === 429) {
    const hours = Math.ceil(Number(response.headers.get('retry-after') ?? 0) / 3600);
    const tier = response.headers.get('x-figma-rate-limit-type');
    throw new RateLimited(
      `Figma's API limit is reached${tier === 'low' ? ' (a View or Collab seat: 20 reads a month)' : ''}; it resets in about ${hours} hour${hours === 1 ? '' : 's'}.\n` +
        'Meanwhile, export the screens with the ReactSmith export plugin in Figma (no API, no limit) and save the file in .reactsmith/figma/.',
    );
  }
  if (!response.ok) throw new Error(`Figma answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return (await response.json()).nodes;
}

/** Variable names, when the plan allows reading them (Enterprise); otherwise none, and the export plugin has them. */
async function getVariables(token, fileKey) {
  const response = await fetch(`${API}/files/${fileKey}/variables/local`, { headers: { 'X-Figma-Token': token } });
  if (!response.ok) return {};
  const { meta } = await response.json();
  const collections = meta.variableCollections ?? {};
  return Object.fromEntries(
    Object.values(meta.variables ?? {}).map((variable) => {
      const collection = collections[variable.variableCollectionId];
      const values = Object.fromEntries((collection?.modes ?? []).map((mode) => [mode.name, variable.valuesByMode[mode.modeId]]));
      return [variable.id, { name: variable.name, collection: collection?.name, type: variable.resolvedType, values }];
    }),
  );
}

async function readBundles(dir) {
  const files = (await readdir(dir).catch(() => [])).filter((file) => file.endsWith('.json'));
  const bundles = await Promise.all(files.map(async (file) => JSON.parse(await readFile(path.join(dir, file), 'utf8'))));
  return bundles.filter((bundle) => bundle.format === FORMAT);
}

export async function main(argv) {
  const refresh = argv.includes('--refresh');
  const outIndex = argv.indexOf('--out');
  const out = outIndex === -1 ? '.reactsmith/figma' : argv[outIndex + 1];
  const targets = argv.filter((arg, index) => !arg.startsWith('--') && (outIndex === -1 || index !== outIndex + 1)).map(parseTarget);

  let fileKey = targets.find((target) => target.fileKey)?.fileKey;
  const config = JSON.parse(await readFile('reactsmith.config.json', 'utf8').catch(() => '{}'));
  const configured = config.design?.figma ? parseTarget(config.design.figma) : {};
  fileKey ??= configured.fileKey;
  const ids = [...new Set(targets.map((target) => target.nodeId).filter(Boolean))];
  if (ids.length === 0 && configured.nodeId) ids.push(configured.nodeId);
  if (!fileKey || ids.length === 0) throw new Error('Pass the Figma links of the screens to save, e.g. node fetch.mjs "https://www.figma.com/design/KEY/Name?node-id=420-559".');

  // What is saved already costs no call.
  const saved = await readBundles(out);
  const known = new Set(saved.filter((bundle) => bundle.fileKey === fileKey || !bundle.fileKey).flatMap((bundle) => bundle.roots));
  const wanted = refresh ? ids : ids.filter((id) => !known.has(id));
  if (wanted.length === 0) {
    console.log(`Already saved in ${out}: ${ids.join(', ')}. Pass --refresh to fetch them again.`);
    return;
  }

  const token = process.env.FIGMA_TOKEN;
  if (!token) throw new Error('Set FIGMA_TOKEN to a Figma personal access token with read access to file contents (never saved by this script).');
  const counter = { calls: 0 };
  const nodes = await getNodes(token, fileKey, wanted, counter);
  const definitions = Object.assign({}, ...saved.map((bundle) => bundle.definitions ?? {}));
  const fetched = {};
  let entries = Object.values(nodes).filter(Boolean);
  // The definitions of the components used, and of those they use in turn: usually one more call.
  for (let missing = missingDefinitions(entries, definitions); missing.length && counter.calls < 5; missing = missingDefinitions(entries, definitions)) {
    const found = await getNodes(token, fileKey, missing, counter);
    entries = Object.values(found).filter(Boolean);
    for (const [id, entry] of Object.entries(found)) {
      definitions[id] = entry?.document ?? null;
      if (entry) fetched[id] = entry.document;
    }
  }

  // The names and the node ids, as the export plugin names its files: two exports never share a file.
  const names = wanted.map((id) => `${nodes[id]?.document?.name ?? 'node'}-${id.replace(':', '-')}`);
  const bundle = {
    format: FORMAT,
    source: 'api',
    fileKey,
    exportedAt: new Date().toISOString(),
    roots: wanted,
    nodes,
    definitions: fetched,
    variables: await getVariables(token, fileKey),
  };
  await mkdir(out, { recursive: true });
  // With the date and time, as the plugin names them: a new export never replaces an older one, which updates compare it with.
  const file = path.join(out, `${bundleName([...names, bundle.exportedAt.slice(0, 16).replace(/[-:]/g, '').replace('T', '-')])}.json`);
  await writeFile(file, `${JSON.stringify(bundle, null, 2)}\n`);
  const variables = Object.keys(bundle.variables).length;
  console.log(
    `Saved ${names.join(', ')} to ${file} with ${counter.calls} file read${counter.calls === 1 ? '' : 's'}: ${Object.keys(fetched).length} component definitions, ` +
      (variables ? `${variables} variables.` : 'no variable names (the plan doesn\'t allow reading them: the export plugin has them).'),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof RateLimited ? error.message : `fetch.mjs: ${error.message}`);
    process.exit(error instanceof RateLimited ? 2 : 1);
  });
}
