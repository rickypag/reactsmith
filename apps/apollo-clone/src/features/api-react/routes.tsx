import type { RouteObject } from 'react-router';

export const apiReactRoutes: RouteObject[] = [
  { path: 'ApolloProvider', lazy: () => import('./views/ApolloProviderView') },
  { path: 'useQuery', lazy: () => import('./views/UseQueryView') },
  { path: 'useLazyQuery', lazy: () => import('./views/UseLazyQueryView') },
  { path: 'useMutation', lazy: () => import('./views/UseMutationView') },
  { path: 'useSubscription', lazy: () => import('./views/UseSubscriptionView') },
  { path: 'useFragment', lazy: () => import('./views/UseFragmentView') },
  { path: 'useApolloClient', lazy: () => import('./views/UseApolloClientView') },
  { path: 'useReactiveVar', lazy: () => import('./views/UseReactiveVarView') },
  { path: 'useSuspenseQuery', lazy: () => import('./views/UseSuspenseQueryView') },
  { path: 'useBackgroundQuery', lazy: () => import('./views/UseBackgroundQueryView') },
  { path: 'useReadQuery', lazy: () => import('./views/UseReadQueryView') },
  { path: 'useLoadableQuery', lazy: () => import('./views/UseLoadableQueryView') },
  { path: 'useQueryRefHandlers', lazy: () => import('./views/UseQueryRefHandlersView') },
  { path: 'skipToken', lazy: () => import('./views/SkipTokenView') },
  { path: 'preloading', lazy: () => import('./views/PreloadingView') },
  { path: 'testing', lazy: () => import('./views/TestingView') },
  { path: 'ssr', lazy: () => import('./views/SsrView') },
];
