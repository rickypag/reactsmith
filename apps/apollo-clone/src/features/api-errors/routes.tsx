import type { RouteObject } from 'react-router';

export const apiErrorsRoutes: RouteObject[] = [
  { path: 'CombinedGraphQLErrors', lazy: () => import('./views/CombinedGraphQLErrorsView') },
  { path: 'CombinedProtocolErrors', lazy: () => import('./views/CombinedProtocolErrorsView') },
  { path: 'LinkError', lazy: () => import('./views/LinkErrorView') },
  { path: 'LocalStateError', lazy: () => import('./views/LocalStateErrorView') },
  { path: 'ServerError', lazy: () => import('./views/ServerErrorView') },
  { path: 'ServerParseError', lazy: () => import('./views/ServerParseErrorView') },
  { path: 'UnconventionalError', lazy: () => import('./views/UnconventionalErrorView') },
];
