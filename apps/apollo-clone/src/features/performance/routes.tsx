import type { RouteObject } from 'react-router';

export const performanceRoutes: RouteObject[] = [
  { path: 'performance', lazy: () => import('./views/PerformanceView') },
  { path: 'optimistic-ui', lazy: () => import('./views/OptimisticUiView') },
  { path: 'server-side-rendering', lazy: () => import('./views/ServerSideRenderingView') },
  { path: 'babel', lazy: () => import('./views/BabelView') },
];
