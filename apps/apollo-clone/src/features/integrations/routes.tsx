import type { RouteObject } from 'react-router';

export const integrationsRoutes: RouteObject[] = [
  { path: 'integrations', lazy: () => import('./views/IntegrationsView') },
  { path: 'nextjs', lazy: () => import('./views/NextJsView') },
  { path: 'react-router', lazy: () => import('./views/ReactRouterView') },
  { path: 'tanstack-start', lazy: () => import('./views/TanstackStartView') },
  { path: 'react-native', lazy: () => import('./views/ReactNativeView') },
  { path: 'webpack', lazy: () => import('./views/WebpackView') },
];
