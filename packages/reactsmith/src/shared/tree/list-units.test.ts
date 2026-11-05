import { describe, expect, it } from 'vitest';
import { createProject } from '../../../test/helpers.js';
import { loadConfig } from '../config/load.js';
import { listUnits } from './list-units.js';

async function unitsOf(tree: Record<string, string>, config: Record<string, unknown> = {}) {
  const root = await createProject(tree, { appFiles: 'app', ...config });
  const { config: resolved } = await loadConfig(root);
  return (await listUnits(root, resolved!)).map((unit) => `${unit.kind} ${unit.folderRel} ${JSON.stringify(unit.owner)}`);
}

describe('tree: listUnits', () => {
  it('lists the shared components, then the app units, then each feature units', async () => {
    const tree = {
      'src/features/docs/views/DocsView/': '',
      'src/features/docs/components/Toc/': '',
      'src/app/layouts/RootLayout/': '',
      'src/app/components/TopBar/': '',
      'src/components/buttons/PrimaryButton/': '',
    };
    expect(await unitsOf(tree)).toEqual([
      'component src/components/buttons/PrimaryButton {"type":"buttons"}',
      'component src/app/components/TopBar {"app":true}',
      'layout src/app/layouts/RootLayout {"app":true}',
      'component src/features/docs/components/Toc {"feature":"docs"}',
      'view src/features/docs/views/DocsView {"feature":"docs"}',
    ]);
  });

  it('lists any folder in a folder of units, but not files or unknown types', async () => {
    const tree = {
      'src/app/components/user-card/': '',
      'src/app/components/Loose.tsx': '',
      'src/components/widgets/Thing/': '',
    };
    expect(await unitsOf(tree)).toEqual(['component src/app/components/user-card {"app":true}']);
  });

  it('follows renamed folders', async () => {
    const tree = { 'src/features/docs/pages/DocsView/': '' };
    expect(await unitsOf(tree, { featureFolders: { views: 'pages' } })).toEqual(['view src/features/docs/pages/DocsView {"feature":"docs"}']);
  });
});
