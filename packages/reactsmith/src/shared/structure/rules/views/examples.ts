import type { RuleExample } from '../types.js';

/** Every code the rule reports. Each one has at least one example. */
export const codes = ['view-naming', 'view-unexpected-file', 'view-file-missing', 'view-entry-missing'] as const;

/** The parts of the rule, in page order. */
export const sections = {
  naming: 'Naming',
  files: 'Files and folders',
} as const;

const config = { appFiles: 'app' };
const view = 'src/features/docs/views/SettingsView';

export const examples: RuleExample<keyof typeof sections>[] = [
  {
    title: 'Views with every file they may hold',
    config,
    tree: {
      [`${view}/SettingsView.tsx`]: '',
      [`${view}/SettingsView.module.css`]: '',
      [`${view}/loader.ts`]: '',
      [`${view}/index.ts`]: '',
      [`${view}/api/queries.ts`]: '',
      [`${view}/tests/SettingsView.test.tsx`]: '',
      [`${view}/stories/SettingsView.stories.tsx`]: '',
      'src/app/views/NotFoundView/NotFoundView.tsx': '',
      'src/app/views/NotFoundView/index.ts': '',
    },
    issues: [],
  },
  {
    section: 'naming',
    title: 'A view folder not in PascalCase',
    config,
    tree: { 'src/features/docs/views/settings-view/settings-view.tsx': '' },
    issues: [
      {
        issue: 'error view-naming src/features/docs/views/settings-view',
        message: 'View folder "settings-view" is not PascalCase.',
        hint: 'Name it like the view it holds, e.g. "SettingsView".',
      },
    ],
  },
  {
    section: 'naming',
    title: 'A view folder without the view suffix',
    config,
    tree: { 'src/features/docs/views/Settings/Settings.tsx': '' },
    issues: [
      {
        issue: 'error view-naming src/features/docs/views/Settings',
        message: 'View folder "Settings" does not end with "View".',
        hint: 'Rename it to "SettingsView", or change "viewSuffix" in reactsmith.config.json.',
      },
    ],
  },
  {
    section: 'files',
    title: 'A helper file in a view folder',
    config,
    tree: { [`${view}/SettingsView.tsx`]: '', [`${view}/index.ts`]: '', [`${view}/helpers.ts`]: '' },
    issues: [
      {
        issue: `error view-unexpected-file ${view}/helpers.ts`,
        message: 'File "helpers.ts" is not allowed in view "SettingsView".',
        hint: "A view folder holds SettingsView.tsx, its style file, loader.ts and index.ts. Move other code to the feature's hooks/, utils/ or types/ folders, and child components to components/.",
      },
    ],
  },
  {
    section: 'files',
    title: 'A components folder inside a view',
    config,
    tree: { [`${view}/SettingsView.tsx`]: '', [`${view}/index.ts`]: '', [`${view}/components/Form/Form.tsx`]: '' },
    issues: [
      {
        issue: `error view-unexpected-file ${view}/components`,
        message: 'Folder "components" is not allowed in view "SettingsView".',
        hint: "A view folder only has the folders api/, tests/, stories/. Move other code to the feature's hooks/, utils/ or types/ folders, and child components to components/.",
      },
    ],
  },
  {
    section: 'files',
    title: 'A view folder without its view file',
    config,
    tree: { [`${view}/index.ts`]: '' },
    issues: [
      {
        issue: `error view-file-missing ${view}`,
        message: 'View folder "SettingsView" has no SettingsView.tsx.',
        hint: 'The view file is named like its folder.',
      },
    ],
  },
  {
    section: 'files',
    title: 'A view folder without its entry point',
    config,
    tree: { [`${view}/SettingsView.tsx`]: '' },
    issues: [
      {
        issue: `error view-entry-missing ${view}`,
        message: 'View folder "SettingsView" has no index.ts.',
        hint: `Add index.ts with "export { SettingsView as Component } from './SettingsView';".`,
      },
    ],
  },
];
