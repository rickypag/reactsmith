import type { RuleExample } from '../types.js';

/** Every code the rule reports. Each one has at least one example. */
export const codes = ['props-type-outside-props'] as const;

const config = { appFiles: 'app' };
const lines = (...text: string[]) => `${text.join('\n')}\n`;

const card = 'src/features/shop/components/ProductCard';
const row = 'src/features/shop/components/ProductRow';
const view = 'src/features/shop/views/ShopView/ShopView.tsx';

/** A card, and a row that repeats it: the row's props use the card's props, as a list of them. */
const COMPONENTS = {
  [`${card}/ProductCard.tsx`]: lines(
    'export interface ProductCardProps {',
    '  title: string;',
    '}',
    '',
    'export const ProductCard: React.FC<ProductCardProps> = ({ title }) => {',
    '  return <article>{title}</article>;',
    '};',
  ),
  [`${card}/index.ts`]: "export { ProductCard } from './ProductCard';\nexport type { ProductCardProps } from './ProductCard';\n",
  [`${row}/ProductRow.tsx`]: lines(
    "import { ProductCard, type ProductCardProps } from '../ProductCard';",
    '',
    'export interface ProductRowProps {',
    '  items: ProductCardProps[];',
    '}',
    '',
    'export const ProductRow: React.FC<ProductRowProps> = ({ items }) => {',
    '  return <div>{items.map((item) => <ProductCard key={item.title} {...item} />)}</div>;',
    '};',
  ),
  [`${row}/index.ts`]: "export { ProductRow } from './ProductRow';\n",
};

export const examples: RuleExample[] = [
  {
    title: 'Props types used for props, and data with a type of its own',
    config,
    tree: {
      ...COMPONENTS,
      'src/features/shop/types/index.ts': 'export interface Product {\n  id: string;\n  title: string;\n}\n',
      'src/features/shop/constants.ts': "import type { Product } from './types';\n\nexport const PRODUCTS: Product[] = [{ id: '1', title: 'Puzzle box' }];\n",
    },
    issues: [],
  },
  {
    title: 'Data typed as the props of a component',
    config,
    tree: {
      ...COMPONENTS,
      'src/features/shop/constants.ts': "import type { ProductCardProps } from './components/ProductCard';\n\nexport const PRODUCTS: ProductCardProps[] = [{ title: 'Puzzle box' }];\n",
    },
    issues: [
      {
        issue: 'error props-type-outside-props src/features/shop/constants.ts',
        message: 'Line 3 uses "ProductCardProps" outside the props of a component: what it types now changes whenever ProductCard\'s props do.',
        hint: 'Give it a type of its own (e.g. in types/), and pass it to ProductCard through its props, e.g. {...item}.',
      },
    ],
  },
  {
    title: 'State typed as the props of a component',
    config,
    tree: {
      ...COMPONENTS,
      'src/features/shop/views/ShopView/api/queries.ts': lines(
        "import { useState } from 'react';",
        "import type { ProductCardProps } from '../../../components/ProductCard';",
        '',
        'export const useProducts = () => useState<ProductCardProps[]>([]);',
      ),
    },
    issues: ['error props-type-outside-props src/features/shop/views/ShopView/api/queries.ts'],
  },
  {
    title: 'A variable of another component typed as the props of a component',
    config,
    tree: {
      ...COMPONENTS,
      [view]: lines(
        "import type { ProductCardProps } from '../../components/ProductCard';",
        "import { ProductRow } from '../../components/ProductRow';",
        '',
        'export const ShopView: React.FC = () => {',
        "  const items: ProductCardProps[] = [{ title: 'Puzzle box' }];",
        '  return <ProductRow items={items} />;',
        '};',
      ),
    },
    issues: ['error props-type-outside-props src/features/shop/views/ShopView/ShopView.tsx'],
  },
];
