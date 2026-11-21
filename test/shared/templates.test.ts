import { describe, expect, it } from 'vitest';
import { addRouteEntry } from '../../src/shared/routes/add.js';
import { renderTemplate } from '../../src/shared/templates/render.js';

describe('renderTemplate', () => {
  it('fills the placeholders', async () => {
    expect(await renderTemplate('view/index.ts', { viewName: 'HomeView' })).toBe(
      "export { HomeView as Component } from './HomeView';\n",
    );
  });

  it('throws on a missing value', async () => {
    await expect(renderTemplate('view/index.ts', {})).rejects.toThrow('uses {{viewName}}, but no value was given');
  });
});

describe('addRouteEntry', () => {
  const entry = "{ path: 'settings', lazy: () => import('./views/SettingsView') }";

  it('adds to an empty array', () => {
    const result = addRouteEntry('export const routes: RouteObject[] = [];\n', 'routes.tsx', 'routes', entry);
    expect(result).toEqual({ status: 'added', text: `export const routes: RouteObject[] = [\n  ${entry},\n];\n` });
  });

  it('adds after the last route, keeping indentation and trailing commas', () => {
    const text = "export const routes = [\n    { index: true, lazy: () => import('./views/HomeView') }\n] satisfies RouteObject[];\n";
    expect(addRouteEntry(text, 'routes.tsx', 'routes', entry)).toEqual({
      status: 'added',
      text: `export const routes = [\n    { index: true, lazy: () => import('./views/HomeView') },\n    ${entry}\n] satisfies RouteObject[];\n`,
    });
  });

  it('asks for manual editing when the array is not found', () => {
    expect(addRouteEntry('export const routes = getRoutes();', 'routes.tsx', 'routes', entry)).toMatchObject({ status: 'manual' });
  });
});
