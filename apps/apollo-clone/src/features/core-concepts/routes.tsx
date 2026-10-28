import type { RouteObject } from 'react-router';

export const coreConceptsRoutes: RouteObject[] = [
  { path: 'queries', lazy: () => import('./views/QueriesView') },
  { path: 'suspense', lazy: () => import('./views/SuspenseView') },
  { path: 'fragments', lazy: () => import('./views/FragmentsView') },
  { path: 'mutations', lazy: () => import('./views/MutationsView') },
  { path: 'typescript', lazy: () => import('./views/TypeScriptView') },
  { path: 'refetching', lazy: () => import('./views/RefetchingView') },
  { path: 'custom-scalars', lazy: () => import('./views/CustomScalarsView') },
  { path: 'event-based-refetching', lazy: () => import('./views/EventBasedRefetchingView') },
  { path: 'subscriptions', lazy: () => import('./views/SubscriptionsView') },
  { path: 'directives', lazy: () => import('./views/DirectivesView') },
  { path: 'error-handling', lazy: () => import('./views/ErrorHandlingView') },
  { path: 'persisted-queries', lazy: () => import('./views/PersistedQueriesView') },
  { path: 'document-transforms', lazy: () => import('./views/DocumentTransformsView') },
  { path: 'defer', lazy: () => import('./views/DeferView') },
  { path: 'operation-best-practices', lazy: () => import('./views/OperationBestPracticesView') },
];
