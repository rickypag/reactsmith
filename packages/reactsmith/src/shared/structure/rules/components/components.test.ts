import { describe, expect, it } from 'vitest';
import { runRule, summary, testExamples } from '../../../../../test/rules.js';
import { checkComponents } from './components.js';
import { codes, examples } from './examples.js';

const run = (tree: Record<string, string>, config?: Record<string, unknown>) => runRule(checkComponents, tree, { appFiles: 'app', ...config });
const card = 'src/app/components/UserCard';
const CARD = { [`${card}/UserCard.tsx`]: '', [`${card}/index.ts`]: '' };

describe('components: examples', () => {
  testExamples(checkComponents, examples, codes);
});

describe('components', () => {
  it('checks the components of features and of each type of shared components', async () => {
    const tree = { 'src/features/docs/components/Toc/Toc.tsx': '', 'src/components/buttons/PrimaryButton/index.ts': '' };
    expect(summary(await run(tree))).toEqual([
      'error component-file-missing src/components/buttons/PrimaryButton',
      'error component-entry-missing src/features/docs/components/Toc',
    ]);
  });

  it('does not look inside a folder that is not PascalCase', async () => {
    expect(summary(await run({ 'src/app/components/user-card/hooks/': '' }))).toEqual(['error component-naming src/app/components/user-card']);
  });

  it('allows any content in tests/ and stories/', async () => {
    expect(await run({ ...CARD, [`${card}/tests/fixtures/user.json`]: '', [`${card}/stories/helpers/mock.ts`]: '' })).toEqual([]);
  });

  it('allows a style file only for a component file that exists', async () => {
    const tree = { ...CARD, [`${card}/UserCard.module.css`]: '', [`${card}/UserCardContent.module.css`]: '' };
    expect(summary(await run(tree))).toEqual([`error component-unexpected-file ${card}/UserCardContent.module.css`]);
  });

  it('follows the configured style format', async () => {
    const tree = { ...CARD, [`${card}/UserCard.styles.ts`]: '', [`${card}/UserCard.module.css`]: '' };
    const issues = await run(tree, { styles: 'tailwind' });
    expect(summary(issues)).toEqual([`error component-unexpected-file ${card}/UserCard.module.css`]);
    expect(issues[0]?.hint).toBe('Styles are tailwind ("styles" in reactsmith.config.json): each component file has its own, e.g. UserCard.styles.ts for UserCard.tsx.');
  });

  it('points stories to stories/', async () => {
    const issues = await run({ ...CARD, [`${card}/UserCard.stories.tsx`]: '' });
    expect(issues[0]?.hint).toBe(`Move it to ${card}/stories/UserCard.stories.tsx.`);
  });

  it('counts layouts in unique names, but not views', async () => {
    const tree = {
      'src/app/layouts/Shell/Shell.tsx': '',
      'src/features/docs/components/Shell/Shell.tsx': '',
      'src/features/docs/components/Shell/index.ts': '',
      'src/features/docs/views/OverviewView/OverviewView.tsx': '',
      'src/features/blog/views/OverviewView/OverviewView.tsx': '',
    };
    expect(summary(await run(tree))).toEqual(['error component-name-taken src/app/layouts/Shell']);
  });
});
