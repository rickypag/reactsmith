import type { RuleExample } from '../types.js';

/** Every code the rule reports. Each one has at least one example. */
export const codes = [
  'src-missing',
  'unknown-folder',
  'unknown-component-type',
  'unknown-app-folder',
  'feature-naming',
  'unknown-feature-folder',
] as const;

/** The parts of the rule, in page order: the top of srcDir, the shared components, the app folder, the feature folders. */
export const sections = {
  project: 'Project',
  shared: 'Shared components',
  app: 'App folder',
  feature: 'Features',
} as const;

export const examples: RuleExample<keyof typeof sections>[] = [
  {
    section: 'project',
    title: 'A project that follows the tree',
    config: { appFiles: 'app' },
    tree: {
      'src/main.tsx': '',
      'src/index.css': '',
      'src/app/App.tsx': '',
      'src/app/layouts/': '',
      'src/app/views/': '',
      'src/components/buttons/': '',
      'src/components/cards/': '',
      'src/hooks/': '',
      'src/features/user-profile/index.ts': '',
      'src/features/user-profile/components/': '',
      'src/features/user-profile/views/': '',
    },
    issues: [],
  },
  {
    section: 'project',
    title: 'The source folder is missing',
    tree: { 'source/main.tsx': '' },
    issues: [
      {
        issue: 'error src-missing src',
        message: 'Source folder "src" does not exist.',
        hint: 'Run the command from the project root, or set "srcDir" in reactsmith.config.json.',
      },
    ],
  },
  {
    section: 'project',
    title: 'A folder that is not in the tree, at the top of src',
    tree: { 'src/services/api.ts': '' },
    issues: [
      {
        issue: 'error unknown-folder src/services',
        message: 'Unknown folder "services" in src/.',
        hint: 'Remove or rename it, or add it to "folders" in reactsmith.config.json, e.g. "services": "services".',
      },
    ],
  },
  {
    section: 'project',
    title: 'A folder name that only differs by case',
    tree: { 'src/Components/': '' },
    issues: [
      {
        issue: 'error unknown-folder src/Components',
        message: 'Unknown folder "Components" in src/.',
        hint: 'Folder names are case-sensitive: rename it to "components".',
      },
    ],
  },
  {
    section: 'shared',
    title: 'A folder that is not a type of shared components',
    config: { appFiles: 'app' },
    tree: { 'src/components/widgets/': '' },
    issues: [
      {
        issue: 'error unknown-component-type src/components/widgets',
        message: '"widgets" is not a type of shared components.',
      },
    ],
  },
  {
    section: 'shared',
    title: 'A shared component outside the folder of its type',
    config: { appFiles: 'app' },
    tree: { 'src/components/PrimaryButton/PrimaryButton.tsx': '' },
    issues: [
      {
        issue: 'error unknown-component-type src/components/PrimaryButton',
        message: '"PrimaryButton" is directly in src/components/, but each shared component lives in the folder of its type.',
        hint: "Move it into its type, e.g. src/components/buttons/PrimaryButton, and export it from the type's index.ts.",
      },
    ],
  },
  {
    section: 'app',
    title: 'A folder the app folder does not allow',
    config: { appFiles: 'app' },
    tree: { 'src/app/App.tsx': '', 'src/app/widgets/': '' },
    issues: [
      {
        issue: 'error unknown-app-folder src/app/widgets',
        message: 'Unknown folder "widgets" in src/app/.',
        hint: 'Remove or rename it, or add it to "appFolders" in reactsmith.config.json, e.g. "widgets": "widgets".',
      },
    ],
  },
  {
    section: 'feature',
    title: 'A feature not named in kebab-case',
    tree: { 'src/features/userProfile/index.ts': '' },
    issues: [
      {
        issue: 'error feature-naming src/features/userProfile',
        message: 'Feature "userProfile" does not follow kebab-case.',
        hint: 'Rename it to "user-profile", or change "featureNaming" in reactsmith.config.json.',
      },
    ],
  },
  {
    section: 'feature',
    title: 'A folder a feature does not allow',
    tree: { 'src/features/auth/index.ts': '', 'src/features/auth/constants/': '' },
    issues: [
      {
        issue: 'error unknown-feature-folder src/features/auth/constants',
        message: 'Unknown folder "constants" in feature "auth".',
        hint: 'Remove or rename it, or add it to "featureFolders" in reactsmith.config.json, e.g. "constants": "constants".',
      },
    ],
  },
];
