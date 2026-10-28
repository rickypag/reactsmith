import type { RouteObject } from 'react-router';

export const apiLinkRoutes: RouteObject[] = [
  { path: 'introduction', lazy: () => import('./views/IntroductionView') },
  { path: 'apollo-link', lazy: () => import('./views/ApolloLinkView') },
  { path: 'apollo-link-base-http', lazy: () => import('./views/BaseHttpLinkView') },
  { path: 'apollo-link-base-batch-http', lazy: () => import('./views/BaseBatchHttpLinkView') },
  { path: 'apollo-link-batch-http', lazy: () => import('./views/BatchHttpLinkView') },
  { path: 'apollo-link-batch', lazy: () => import('./views/BatchLinkView') },
  { path: 'apollo-link-client-awareness', lazy: () => import('./views/ClientAwarenessLinkView') },
  { path: 'apollo-link-error', lazy: () => import('./views/ErrorLinkView') },
  { path: 'apollo-link-subscriptions', lazy: () => import('./views/GraphQLWsLinkView') },
  { path: 'apollo-link-http', lazy: () => import('./views/HttpLinkView') },
  { path: 'apollo-link-persisted-queries', lazy: () => import('./views/PersistedQueryLinkView') },
  { path: 'apollo-link-remove-typename', lazy: () => import('./views/RemoveTypenameLinkView') },
  { path: 'apollo-link-retry', lazy: () => import('./views/RetryLinkView') },
  { path: 'apollo-link-schema', lazy: () => import('./views/SchemaLinkView') },
  { path: 'apollo-link-context', lazy: () => import('./views/SetContextLinkView') },
  { path: 'apollo-link-ws', lazy: () => import('./views/WebSocketLinkView') },
  { path: 'community-links', lazy: () => import('./views/CommunityLinksView') },
];
