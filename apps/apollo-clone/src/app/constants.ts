export const NAVIGATION = [
  {
    title: 'Overview',
    pages: [
      { label: 'Introduction', href: '/' },
      { label: 'Why Apollo Client?', href: '/why-apollo' },
      { label: 'Get started', href: '/get-started' },
      {
        label: 'Migrating to Apollo Client 4.0',
        href: '/migrating/apollo-client-4-migration',
      },
      { label: 'Versioning policy', href: '/versioning-policy' },
    ],
  },
  {
    title: 'Core concepts',
    pages: [
      { label: 'Queries', href: '/data/queries' },
      { label: 'Suspense', href: '/data/suspense' },
      { label: 'Fragments', href: '/data/fragments' },
      { label: 'Mutations', href: '/data/mutations' },
      { label: 'TypeScript', href: '/data/typescript' },
      { label: 'Refetching', href: '/data/refetching' },
      { label: 'Custom scalars', href: '/data/custom-scalars' },
      { label: 'Event-based refetching', href: '/data/event-based-refetching' },
      { label: 'Subscriptions', href: '/data/subscriptions' },
      { label: 'Directives', href: '/data/directives' },
      { label: 'Error handling', href: '/data/error-handling' },
      { label: 'Persisted queries', href: '/data/persisted-queries' },
      { label: 'Document transforms', href: '/data/document-transforms' },
      { label: 'Deferred responses', href: '/data/defer' },
      { label: 'Best practices', href: '/data/operation-best-practices' },
    ],
  },
  {
    title: 'Caching',
    pages: [
      { label: 'Overview', href: '/caching/overview' },
      { label: 'Configuration', href: '/caching/cache-configuration' },
      { label: 'Reading and writing', href: '/caching/cache-interaction' },
      {
        label: 'Garbage collection and eviction',
        href: '/caching/garbage-collection',
      },
      {
        label: 'Customizing field behavior',
        href: '/caching/cache-field-behavior',
      },
      { label: 'Memory management', href: '/caching/memory-management' },
      { label: 'Advanced topics', href: '/caching/advanced-topics' },
    ],
  },
  {
    title: 'Pagination',
    pages: [
      { label: 'Overview', href: '/pagination/overview' },
      { label: 'Core API', href: '/pagination/core-api' },
      { label: 'Offset-based', href: '/pagination/offset-based' },
      { label: 'Cursor-based', href: '/pagination/cursor-based' },
      { label: 'keyArgs', href: '/pagination/key-args' },
    ],
  },
  {
    title: 'Local State',
    pages: [
      { label: 'Overview', href: '/local-state/local-state-management' },
      {
        label: 'Local-only fields',
        href: '/local-state/managing-state-with-field-policies',
      },
      { label: 'Reactive variables', href: '/local-state/reactive-variables' },
      { label: 'Local resolvers', href: '/local-state/local-resolvers' },
    ],
  },
  {
    title: 'Development & Testing',
    pages: [
      {
        label: 'Developer tools',
        href: '/development-testing/developer-tooling',
      },
      { label: 'GraphQL Codegen', href: '/development-testing/graphql-codegen' },
      {
        label: 'Testing React components',
        href: '/development-testing/testing',
      },
      {
        label: 'Schema-driven testing',
        href: '/development-testing/schema-driven-testing',
      },
      {
        label: 'Mocking schema capabilities',
        href: '/development-testing/client-schema-mocking',
      },
      {
        label: 'Reducing bundle size',
        href: '/development-testing/reducing-bundle-size',
      },
    ],
  },
  {
    title: 'Performance',
    pages: [
      { label: 'Improving performance', href: '/performance/performance' },
      {
        label: 'Optimistic mutation results',
        href: '/performance/optimistic-ui',
      },
      {
        label: 'Server-side rendering',
        href: '/performance/server-side-rendering',
      },
      { label: 'Compiling queries with Babel', href: '/performance/babel' },
    ],
  },
  {
    title: 'Integrations',
    pages: [
      { label: 'View integrations', href: '/integrations/integrations' },
      { label: 'Next.js App Router', href: '/integrations/nextjs' },
      {
        label: 'React Router framework mode',
        href: '/integrations/react-router',
      },
      { label: 'TanStack Start', href: '/integrations/tanstack-start' },
      { label: 'React Native', href: '/integrations/react-native' },
      { label: 'Loading queries with Webpack', href: '/integrations/webpack' },
    ],
  },
  {
    title: 'Networking',
    pages: [
      {
        label: 'Basic HTTP networking',
        href: '/networking/basic-http-networking',
      },
      {
        label: 'Advanced HTTP networking',
        href: '/networking/advanced-http-networking',
      },
      { label: 'Authentication', href: '/networking/authentication' },
    ],
  },
  {
    title: 'API Reference: Core',
    pages: [
      { label: 'ApolloClient', href: '/api/core/ApolloClient' },
      { label: 'InMemoryCache', href: '/api/cache/InMemoryCache' },
      { label: 'ObservableQuery', href: '/api/core/ObservableQuery' },
    ],
  },
  {
    title: 'API Reference: Errors',
    pages: [
      {
        label: 'CombinedGraphQLErrors',
        href: '/api/errors/CombinedGraphQLErrors',
      },
      {
        label: 'CombinedProtocolErrors',
        href: '/api/errors/CombinedProtocolErrors',
      },
      { label: 'LinkError', href: '/api/errors/LinkError' },
      { label: 'LocalStateError', href: '/api/errors/LocalStateError' },
      { label: 'ServerError', href: '/api/errors/ServerError' },
      { label: 'ServerParseError', href: '/api/errors/ServerParseError' },
      { label: 'UnconventionalError', href: '/api/errors/UnconventionalError' },
    ],
  },
  {
    title: 'API Reference: React',
    pages: [
      { label: 'ApolloProvider', href: '/api/react/ApolloProvider' },
      { label: 'useQuery', href: '/api/react/useQuery' },
      { label: 'useLazyQuery', href: '/api/react/useLazyQuery' },
      { label: 'useMutation', href: '/api/react/useMutation' },
      { label: 'useSubscription', href: '/api/react/useSubscription' },
      { label: 'useFragment', href: '/api/react/useFragment' },
      { label: 'useApolloClient', href: '/api/react/useApolloClient' },
      { label: 'useReactiveVar', href: '/api/react/useReactiveVar' },
      { label: 'useSuspenseQuery', href: '/api/react/useSuspenseQuery' },
      { label: 'useBackgroundQuery', href: '/api/react/useBackgroundQuery' },
      { label: 'useReadQuery', href: '/api/react/useReadQuery' },
      { label: 'useLoadableQuery', href: '/api/react/useLoadableQuery' },
      { label: 'useQueryRefHandlers', href: '/api/react/useQueryRefHandlers' },
      { label: 'skipToken', href: '/api/react/skipToken' },
      { label: 'createQueryPreloader', href: '/api/react/preloading' },
      { label: 'MockProvider', href: '/api/react/testing' },
      { label: 'SSR', href: '/api/react/ssr' },
    ],
  },
  {
    title: 'API Reference: Apollo Link',
    pages: [
      { label: 'Overview', href: '/api/link/introduction' },
      { label: 'ApolloLink', href: '/api/link/apollo-link' },
      { label: 'BaseHttpLink', href: '/api/link/apollo-link-base-http' },
      {
        label: 'BaseBatchHttpLink',
        href: '/api/link/apollo-link-base-batch-http',
      },
      { label: 'BatchHttpLink', href: '/api/link/apollo-link-batch-http' },
      { label: 'BatchLink', href: '/api/link/apollo-link-batch' },
      {
        label: 'ClientAwarenessLink',
        href: '/api/link/apollo-link-client-awareness',
      },
      { label: 'ErrorLink', href: '/api/link/apollo-link-error' },
      { label: 'GraphQLWsLink', href: '/api/link/apollo-link-subscriptions' },
      { label: 'HttpLink', href: '/api/link/apollo-link-http' },
      {
        label: 'PersistedQueryLink',
        href: '/api/link/apollo-link-persisted-queries',
      },
      {
        label: 'RemoveTypenameFromVariablesLink',
        href: '/api/link/apollo-link-remove-typename',
      },
      { label: 'RetryLink', href: '/api/link/apollo-link-retry' },
      { label: 'SchemaLink', href: '/api/link/apollo-link-schema' },
      { label: 'SetContextLink', href: '/api/link/apollo-link-context' },
      { label: 'WebSocketLink', href: '/api/link/apollo-link-ws' },
      { label: 'Community links', href: '/api/link/community-links' },
    ],
  },
];
