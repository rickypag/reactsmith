import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error: a plain script of the Figma skill, without types.
import { bundleName, main, missingDefinitions, parseTarget, RateLimited } from '../../skills/reactsmith-from-figma/fetch.mjs';

const LINK = 'https://www.figma.com/design/KEY123/Docs?node-id=427-248&t=x';
const node = (id: string, name: string, components: Record<string, object> = {}) => ({ document: { id, name, type: 'FRAME' }, components, componentSets: {} });

/** A fake Figma API: the nodes it knows, and the calls it gets. */
function fakeFigma(known: Record<string, object>, status = 200) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(url);
    if (status === 429) return new Response('', { status: 429, headers: { 'retry-after': '68607', 'x-figma-rate-limit-type': 'low' } });
    if (url.includes('/variables/local')) return new Response('{}', { status: 403 });
    const ids = decodeURIComponent(/ids=([^&]+)/.exec(url)![1]!).split(',');
    return Response.json({ nodes: Object.fromEntries(ids.map((id) => [id, known[id] ?? null])) });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('the Figma fetch script', () => {
  it('reads links and node ids', () => {
    expect(parseTarget(LINK)).toEqual({ fileKey: 'KEY123', nodeId: '427:248' });
    expect(parseTarget('430-248')).toEqual({ fileKey: undefined, nodeId: '430:248' });
    expect(bundleName(['Introduction', 'Root Layout'])).toBe('introduction-root-layout');
  });

  it('asks for the sets of variants and for standalone components, once', () => {
    const entry = { components: { '1:2': { componentSetId: '1:1' }, '1:3': { componentSetId: '1:1' }, '2:1': {}, '9:9': { remote: true } } };
    expect(missingDefinitions([entry], {})).toEqual(['1:1', '2:1']);
    expect(missingDefinitions([entry], { '1:1': {} })).toEqual(['2:1']);
  });

  it('saves several screens with one call, their definitions with one more, and nothing again once saved', async () => {
    const out = await mkdtemp(path.join(tmpdir(), 'figma-'));
    vi.stubEnv('FIGMA_TOKEN', 'token');
    const calls = fakeFigma({
      '427:248': node('427:248', 'RootLayout', { '420:537': { componentSetId: '420:545' } }),
      '430:248': node('430:248', 'Introduction'),
      '420:545': node('420:545', 'app/SidebarLink'),
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await main([LINK, '430-248', '--out', out]);
    const fileCalls = calls.filter((url) => url.includes('/nodes'));
    expect(fileCalls).toHaveLength(2);
    expect(fileCalls[0]).toContain(encodeURIComponent('427:248,430:248'));

    const [file] = await readdir(out);
    const bundle = JSON.parse(await readFile(path.join(out, file!), 'utf8'));
    expect(bundle).toMatchObject({ format: 'reactsmith-figma/1', source: 'api', fileKey: 'KEY123', roots: ['427:248', '430:248'] });
    expect(Object.keys(bundle.definitions)).toEqual(['420:545']);

    await main([LINK, '430-248', '--out', out]);
    expect(calls.filter((url) => url.includes('/nodes'))).toHaveLength(2);
  });

  it('stops at the rate limit without retrying, and says what to do', async () => {
    const out = await mkdtemp(path.join(tmpdir(), 'figma-'));
    vi.stubEnv('FIGMA_TOKEN', 'token');
    const calls = fakeFigma({}, 429);
    const error = await main([LINK, '--out', out]).catch((caught: Error) => caught);
    expect(error).toBeInstanceOf(RateLimited);
    expect(error.message).toContain('20 reads a month');
    expect(error.message).toContain('about 20 hours');
    expect(error.message).toContain('export plugin');
    expect(calls).toHaveLength(1);
  });
});
