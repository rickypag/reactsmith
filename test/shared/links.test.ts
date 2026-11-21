import { describe, expect, it } from 'vitest';
import { checkStructure } from '../../src/shared/structure/check.js';
import { createProject } from '../helpers.js';

const file = 'src/app/components/TopBar/TopBar.tsx';
const TOP_BAR = (links: string) => ({
  [file]: `export const TopBar: React.FC = () => {\n  return (\n    <header>\n${links}\n    </header>\n  );\n};\n`,
  'src/app/components/TopBar/index.ts': "export { TopBar } from './TopBar';\n",
});
const router = { library: 'react-router', version: 7, mode: 'data' };

describe('check: plain links inside the app', () => {
  it('warns about <a href="/…"> in a project with a router, and nothing else', async () => {
    const links = [
      '      <a href="/docs">Docs</a>',
      '      <a href="https://github.com">GitHub</a>',
      '      <a href="//cdn.example.com/x.js">CDN</a>',
      '      <a href="#top">Top</a>',
      '      <a href={href}>Variable</a>',
    ].join('\n');
    const root = await createProject(TOP_BAR(links), { appFiles: 'app', router });
    const warnings = (await checkStructure(root)).issues.filter((issue) => issue.code === 'plain-internal-link');
    expect(warnings).toEqual([expect.objectContaining({ severity: 'warning', path: file, message: '<a href="/docs"> (line 4) links to a path of the site, so it reloads the whole page.' })]);
  });

  it('says nothing without a router', async () => {
    const root = await createProject(TOP_BAR('      <a href="/docs">Docs</a>'), { appFiles: 'app' });
    expect((await checkStructure(root)).issues.filter((issue) => issue.code === 'plain-internal-link')).toEqual([]);
  });
});
