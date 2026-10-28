import type { RouteObject } from 'react-router';

export const overviewRoutes: RouteObject[] = [
  { index: true, lazy: () => import('./views/IntroductionView') },
  { path: 'why-apollo', lazy: () => import('./views/WhyApolloView') },
  { path: 'get-started', lazy: () => import('./views/GetStartedView') },
  { path: 'migrating/apollo-client-4-migration', lazy: () => import('./views/ApolloClient4MigrationView') },
  { path: 'versioning-policy', lazy: () => import('./views/VersioningPolicyView') },
];
