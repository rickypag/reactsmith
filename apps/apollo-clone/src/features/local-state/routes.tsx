import type { RouteObject } from 'react-router';

export const localStateRoutes: RouteObject[] = [
  { path: 'local-state-management', lazy: () => import('./views/LocalStateManagementView') },
  { path: 'managing-state-with-field-policies', lazy: () => import('./views/FieldPoliciesView') },
  { path: 'reactive-variables', lazy: () => import('./views/ReactiveVariablesView') },
  { path: 'local-resolvers', lazy: () => import('./views/LocalResolversView') },
];
