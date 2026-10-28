import type { RouteObject } from 'react-router';

export const apiCoreRoutes: RouteObject[] = [
  { path: 'core/ApolloClient', lazy: () => import('./views/ApolloClientView') },
  { path: 'cache/InMemoryCache', lazy: () => import('./views/InMemoryCacheView') },
  { path: 'core/ObservableQuery', lazy: () => import('./views/ObservableQueryView') },
];
