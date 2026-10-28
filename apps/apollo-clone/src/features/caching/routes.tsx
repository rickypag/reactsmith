import type { RouteObject } from 'react-router';

export const cachingRoutes: RouteObject[] = [
  { path: 'overview', lazy: () => import('./views/OverviewView') },
  { path: 'cache-configuration', lazy: () => import('./views/CacheConfigurationView') },
  { path: 'cache-interaction', lazy: () => import('./views/CacheInteractionView') },
  { path: 'garbage-collection', lazy: () => import('./views/GarbageCollectionView') },
  { path: 'cache-field-behavior', lazy: () => import('./views/CacheFieldBehaviorView') },
  { path: 'memory-management', lazy: () => import('./views/MemoryManagementView') },
  { path: 'advanced-topics', lazy: () => import('./views/AdvancedTopicsView') },
];
