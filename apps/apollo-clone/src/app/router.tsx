import { createBrowserRouter, type RouteObject } from 'react-router';
import { RootLayout } from './layouts/RootLayout';
import { overviewRoutes } from '@/features/overview';
import { coreConceptsRoutes } from '@/features/core-concepts';
import { cachingRoutes } from '@/features/caching';
import { paginationRoutes } from '@/features/pagination';
import { localStateRoutes } from '@/features/local-state';
import { developmentTestingRoutes } from '@/features/development-testing';
import { performanceRoutes } from '@/features/performance';
import { integrationsRoutes } from '@/features/integrations';
import { networkingRoutes } from '@/features/networking';
import { apiCoreRoutes } from '@/features/api-core';
import { apiErrorsRoutes } from '@/features/api-errors';
import { apiReactRoutes } from '@/features/api-react';
import { apiLinkRoutes } from '@/features/api-link';

const routes: RouteObject[] = [
  {
    path: '/',
    Component: RootLayout,
    children: [
      { path: '*', lazy: () => import('./views/NotFoundView') },
      { children: overviewRoutes },
      { path: 'data', children: coreConceptsRoutes },
      { path: 'caching', children: cachingRoutes },
      { path: 'pagination', children: paginationRoutes },
      { path: 'local-state', children: localStateRoutes },
      { path: 'development-testing', children: developmentTestingRoutes },
      { path: 'performance', children: performanceRoutes },
      { path: 'integrations', children: integrationsRoutes },
      { path: 'networking', children: networkingRoutes },
      { path: 'api', children: apiCoreRoutes },
      { path: 'api/errors', children: apiErrorsRoutes },
      { path: 'api/react', children: apiReactRoutes },
      { path: 'api/link', children: apiLinkRoutes },
    ],
  },
];

export const router = createBrowserRouter(routes);
