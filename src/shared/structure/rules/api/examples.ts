import type { RuleExample } from '../types.js';

/** Every code the rule reports. Each one has at least one example. */
export const codes = ['api-unexpected-file', 'api-file-missing'] as const;

const config = { appFiles: 'app' };
const card = 'src/app/components/UserCard';
const view = 'src/features/docs/views/SettingsView';

export const examples: RuleExample[] = [
  {
    title: 'A component that loads and edits data, and a view that loads data',
    config,
    tree: { [`${card}/api/queries.ts`]: '', [`${card}/api/mutations.ts`]: '', [`${view}/api/queries.ts`]: '' },
    issues: [],
  },
  {
    title: 'A helper file in api/',
    config,
    tree: { [`${card}/api/queries.ts`]: '', [`${card}/api/client.ts`]: '' },
    issues: [
      {
        issue: `error api-unexpected-file ${card}/api/client.ts`,
        message: `File "client.ts" is not allowed in ${card}/api/, which may only contain queries.ts and mutations.ts.`,
        hint: `Move queries to ${card}/api/queries.ts and mutations to ${card}/api/mutations.ts. Other code belongs in the feature's hooks/, utils/ or types/ folders.`,
      },
    ],
  },
  {
    title: 'A folder in api/',
    config,
    tree: { [`${view}/api/queries.ts`]: '', [`${view}/api/helpers/format.ts`]: '' },
    issues: [
      {
        issue: `error api-unexpected-file ${view}/api/helpers`,
        message: `Folder "helpers" is not allowed in ${view}/api/, which may only contain queries.ts.`,
        hint: `Move queries to ${view}/api/queries.ts. Other code belongs in the feature's hooks/, utils/ or types/ folders.`,
      },
    ],
  },
  {
    title: 'Mutations in the api/ of a view',
    config,
    tree: { [`${view}/api/queries.ts`]: '', [`${view}/api/mutations.ts`]: '' },
    issues: [
      {
        issue: `error api-unexpected-file ${view}/api/mutations.ts`,
        message: "Views only load data, so a view's api/ has no mutations.ts.",
        hint: 'Move each mutation to the api/mutations.ts of the component that edits the data.',
      },
    ],
  },
  {
    title: 'An empty api/ folder',
    config,
    tree: { [`${card}/api/`]: '' },
    issues: [
      {
        issue: `error api-file-missing ${card}/api`,
        message: 'The api/ folder of component "UserCard" has no queries.ts or mutations.ts.',
        hint: `Add ${card}/api/queries.ts or ${card}/api/mutations.ts, or remove the api/ folder if the component has no data access.`,
      },
    ],
  },
];
