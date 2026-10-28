import type { RouteObject } from 'react-router';

export const networkingRoutes: RouteObject[] = [
  { path: 'basic-http-networking', lazy: () => import('./views/BasicHttpNetworkingView') },
  { path: 'advanced-http-networking', lazy: () => import('./views/AdvancedHttpNetworkingView') },
  { path: 'authentication', lazy: () => import('./views/AuthenticationView') },
];
