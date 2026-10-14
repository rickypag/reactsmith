import { createBrowserRouter, type RouteObject } from 'react-router';

const routes: RouteObject[] = [
  {
    path: '/',
    children: [],
  },
];

export const router = createBrowserRouter(routes);
