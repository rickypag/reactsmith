import type { RuleExample } from '../types.js';

/** Every code the rule reports. Each one has at least one example. */
export const codes = [
  'component-naming',
  'component-unexpected-file',
  'component-file-missing',
  'component-entry-missing',
  'component-split-missing',
  'component-name-taken',
] as const;

/** The parts of the rule, in page order. */
export const sections = {
  naming: 'Naming',
  files: 'Files and folders',
  split: 'Components that load data',
  unique: 'Unique names',
} as const;

const config = { appFiles: 'app' };
const card = 'src/app/components/UserCard';

export const examples: RuleExample<keyof typeof sections>[] = [
  {
    title: 'Components with every file they may hold',
    config,
    tree: {
      [`${card}/UserCard.tsx`]: '',
      [`${card}/UserCard.module.css`]: '',
      [`${card}/index.ts`]: '',
      [`${card}/types.ts`]: '',
      [`${card}/utils.ts`]: '',
      [`${card}/constants.ts`]: '',
      [`${card}/tests/UserCard.test.tsx`]: '',
      [`${card}/stories/UserCard.stories.tsx`]: '',
      'src/features/docs/components/Toc/Toc.tsx': '',
      'src/features/docs/components/Toc/TocContent.tsx': '',
      'src/features/docs/components/Toc/TocSkeleton.tsx': '',
      'src/features/docs/components/Toc/index.ts': '',
      'src/features/docs/components/Toc/api/queries.ts': '',
      'src/components/buttons/PrimaryButton/PrimaryButton.tsx': '',
      'src/components/buttons/PrimaryButton/index.ts': '',
    },
    issues: [],
  },
  {
    section: 'naming',
    title: 'A component folder not in PascalCase',
    config,
    tree: { 'src/app/components/user-card/user-card.tsx': '' },
    issues: [
      {
        issue: 'error component-naming src/app/components/user-card',
        message: 'Component folder "user-card" is not PascalCase.',
        hint: 'Name it like the component it holds, e.g. "UserCard".',
      },
    ],
  },
  {
    section: 'files',
    title: 'A second component in the folder of another',
    config,
    tree: { [`${card}/UserCard.tsx`]: '', [`${card}/index.ts`]: '', [`${card}/UserAvatar.tsx`]: '' },
    issues: [
      {
        issue: `error component-unexpected-file ${card}/UserAvatar.tsx`,
        message: 'File "UserAvatar.tsx" is not allowed in component "UserCard".',
        hint: 'A component folder holds UserCard.tsx, UserCardContent.tsx, UserCardSkeleton.tsx, their style files and index.ts, types.ts, utils.ts, constants.ts. Move other code into one of them, or into its own component.',
      },
    ],
  },
  {
    section: 'files',
    title: 'A style file in another format than the configured one',
    config,
    tree: { [`${card}/UserCard.tsx`]: '', [`${card}/index.ts`]: '', [`${card}/UserCard.css`]: '' },
    issues: [
      {
        issue: `error component-unexpected-file ${card}/UserCard.css`,
        message: 'File "UserCard.css" is not allowed in component "UserCard".',
        hint: 'Styles are css-modules ("styles" in reactsmith.config.json): each component file has its own, e.g. UserCard.module.css for UserCard.tsx.',
      },
    ],
  },
  {
    section: 'files',
    title: 'A test next to the component instead of in tests/',
    config,
    tree: { [`${card}/UserCard.tsx`]: '', [`${card}/index.ts`]: '', [`${card}/UserCard.test.tsx`]: '' },
    issues: [
      {
        issue: `error component-unexpected-file ${card}/UserCard.test.tsx`,
        message: 'File "UserCard.test.tsx" is not allowed in component "UserCard".',
        hint: `Move it to ${card}/tests/UserCard.test.tsx.`,
      },
    ],
  },
  {
    section: 'files',
    title: 'A folder other than api/, tests/ and stories/',
    config,
    tree: { [`${card}/UserCard.tsx`]: '', [`${card}/index.ts`]: '', [`${card}/hooks/useUser.ts`]: '' },
    issues: [
      {
        issue: `error component-unexpected-file ${card}/hooks`,
        message: 'Folder "hooks" is not allowed in component "UserCard".',
        hint: "A component folder only has the folders api/, tests/, stories/. Move its code into the component's files, or into its own component.",
      },
    ],
  },
  {
    section: 'files',
    title: 'A component folder without its component file',
    config,
    tree: { [`${card}/index.ts`]: '', [`${card}/Card.tsx`]: '' },
    issues: [
      `error component-unexpected-file ${card}/Card.tsx`,
      {
        issue: `error component-file-missing ${card}`,
        message: 'Component folder "UserCard" has no UserCard.tsx.',
        hint: 'The main component file is named like its folder.',
      },
    ],
  },
  {
    section: 'files',
    title: 'A component folder without its entry point',
    config,
    tree: { [`${card}/UserCard.tsx`]: '' },
    issues: [
      {
        issue: `error component-entry-missing ${card}`,
        message: 'Component folder "UserCard" has no index.ts.',
        hint: `Add index.ts with "export { UserCard } from './UserCard';".`,
      },
    ],
  },
  {
    section: 'split',
    title: 'A component that loads data, without Content and Skeleton',
    config,
    tree: { [`${card}/UserCard.tsx`]: '', [`${card}/index.ts`]: '', [`${card}/api/queries.ts`]: '' },
    issues: [
      {
        issue: `error component-split-missing ${card}`,
        message: 'Component "UserCard" loads data (api/queries.ts), so it needs UserCardContent.tsx: the UI, without data access.',
        hint: 'UserCard.tsx handles the data and its states, and renders UserCardContent or UserCardSkeleton.',
      },
      {
        issue: `error component-split-missing ${card}`,
        message: 'Component "UserCard" loads data (api/queries.ts), so it needs UserCardSkeleton.tsx: what is shown while loading.',
      },
    ],
  },
  {
    section: 'split',
    title: 'A component that only edits data, without Content',
    config,
    tree: { [`${card}/UserCard.tsx`]: '', [`${card}/index.ts`]: '', [`${card}/api/mutations.ts`]: '' },
    issues: [
      {
        issue: `error component-split-missing ${card}`,
        message: 'Component "UserCard" edits data (api/mutations.ts), so it needs UserCardContent.tsx: the UI, without data access.',
        hint: 'UserCard.tsx handles the data and its states, and renders UserCardContent.',
      },
    ],
  },
  {
    section: 'unique',
    title: 'Two components with the same name',
    config,
    tree: {
      'src/app/components/Header/Header.tsx': '',
      'src/app/components/Header/index.ts': '',
      'src/features/docs/components/Header/Header.tsx': '',
      'src/features/docs/components/Header/index.ts': '',
    },
    issues: [
      {
        issue: 'error component-name-taken src/app/components/Header',
        message: '"Header" is the name of 2 components: src/features/docs/components/Header, src/app/components/Header.',
        hint: 'Component names are unique in the project: rename all but one, e.g. with a name that says where it is used.',
      },
    ],
  },
];
