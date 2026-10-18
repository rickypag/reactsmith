import { describe, expect, it } from 'vitest';
import { checkApiFolder, COMPONENT_API_FILES } from '../../src/shared/structure/api.js';
import type { Issue } from '../../src/shared/issues.js';
import { createProject } from '../helpers.js';

describe('checkApiFolder: components', () => {
  const owner = 'src/components/UserCard';

  async function check(tree: Record<string, string>) {
    const root = await createProject(tree);
    const issues: Issue[] = [];
    await checkApiFolder(root, owner, 'component', COMPONENT_API_FILES, issues);
    return issues.map((issue) => `${issue.code} ${issue.path}`);
  }

  it('accepts no api folder', async () => {
    expect(await check({ [`${owner}/UserCard.tsx`]: '' })).toEqual([]);
  });

  it.each([[['queries.ts']], [['mutations.ts']], [['queries.ts', 'mutations.ts']]])('accepts %j', async (files) => {
    expect(await check(Object.fromEntries(files.map((file) => [`${owner}/api/${file}`, ''])))).toEqual([]);
  });

  it('reports empty api folders and other files', async () => {
    expect(await check({ [`${owner}/api/`]: '' })).toEqual([`api-file-missing ${owner}/api`]);
    expect(await check({ [`${owner}/api/mutations.ts`]: '', [`${owner}/api/index.ts`]: '' })).toEqual([
      `api-unexpected-file ${owner}/api/index.ts`,
    ]);
  });
});
