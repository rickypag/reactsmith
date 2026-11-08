import { describe, expect, it } from 'vitest';
import { createProject } from '../../../../../test/helpers.js';
import { testExamples } from '../../../../../test/rules.js';
import { requireConfig } from '../../../config/load.js';
import { codes, examples } from './examples.js';
import { checkTyping } from './typing.js';

describe('typing: examples', () => {
  testExamples(checkTyping, examples, codes);
});

describe('typing: props types', () => {
  const card = 'src/components/cards/Card';
  const tree = {
    [`${card}/Card.tsx`]: 'export interface CardProps {\n  title: string;\n}\n\nexport const Card: React.FC<CardProps> = ({ title }) => <div>{title}</div>;\n',
    [`${card}/index.ts`]: "export { Card } from './Card';\nexport type { CardProps } from './Card';\n",
    'src/components/cards/index.ts': "export { Card } from './Card';\nexport type { CardProps } from './Card';\n",
  };

  async function issues(extra: Record<string, string>) {
    const root = await createProject({ ...tree, ...extra }, { appFiles: 'app' });
    const config = await requireConfig(root);
    return (await checkTyping(root, config)).map((issue) => `${issue.code} ${issue.path}`);
  }

  it('leaves the component\'s own folder alone, stories and tests included', async () => {
    expect(await issues({ [`${card}/stories/Card.stories.tsx`]: "import type { CardProps } from '../Card';\nexport const args: CardProps = { title: 'x' };\n" })).toEqual([]);
  });

  it('reports a types/ file, once per file and props type', async () => {
    const shared = "import type { CardProps } from '@/components/cards';\n\nexport type Deck = CardProps[];\nexport type Hand = CardProps[];\n";
    expect(await issues({ 'src/types/deck.ts': shared })).toEqual(['props-type-outside-props src/types/deck.ts']);
  });

  it('ignores a name that only looks like a props type', async () => {
    expect(await issues({ 'src/types/deck.ts': 'export interface ButtonProps {\n  label: string;\n}\nexport type Deck = ButtonProps[];\n' })).toEqual([]);
  });
});
