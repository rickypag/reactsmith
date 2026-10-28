import { createBrowserRouter, type RouteObject } from 'react-router';
import { RootLayout } from './layouts/RootLayout';

const routes: RouteObject[] = [
  {
    path: '/',
    Component: RootLayout,
    children: [
      { path: '*', lazy: () => import('./views/NotFoundView') },
    ],
  },
];

export const router = createBrowserRouter(routes);
