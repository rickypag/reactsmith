import type { RouteObject } from 'react-router';

export const developmentTestingRoutes: RouteObject[] = [
  { path: 'developer-tooling', lazy: () => import('./views/DeveloperToolingView') },
  { path: 'graphql-codegen', lazy: () => import('./views/GraphqlCodegenView') },
  { path: 'testing', lazy: () => import('./views/TestingView') },
  { path: 'schema-driven-testing', lazy: () => import('./views/SchemaDrivenTestingView') },
  { path: 'client-schema-mocking', lazy: () => import('./views/ClientSchemaMockingView') },
  { path: 'reducing-bundle-size', lazy: () => import('./views/ReducingBundleSizeView') },
];
