import type { RouteObject } from 'react-router';

export const paginationRoutes: RouteObject[] = [
  { path: 'overview', lazy: () => import('./views/OverviewView') },
  { path: 'core-api', lazy: () => import('./views/CoreApiView') },
  { path: 'offset-based', lazy: () => import('./views/OffsetBasedView') },
  { path: 'cursor-based', lazy: () => import('./views/CursorBasedView') },
  { path: 'key-args', lazy: () => import('./views/KeyArgsView') },
];
