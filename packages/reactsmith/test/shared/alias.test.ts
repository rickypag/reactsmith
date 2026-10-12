import { describe, expect, it } from 'vitest';
import { addPathAlias } from '../../src/shared/alias/tsconfig.js';
import { addViteAlias } from '../../src/shared/alias/vite.js';
import { VITE_PROJECT } from '../helpers.js';

describe('addPathAlias', () => {
  it('adds paths and keeps comments', () => {
    const result = addPathAlias(VITE_PROJECT['tsconfig.app.json']!, '@', 'src');
    expect(result.status).toBe('added');
    const text = (result as { text: string }).text;
    expect(text).toContain('/* Bundler mode */');
    expect(text).toContain('/* Linting */');
    expect(text).toMatch(/"paths": \{\s+"@\/\*": \[\s*"\.\/src\/\*"\s*\]/);
  });

  it('is idempotent and reports conflicts', () => {
    const added = addPathAlias(VITE_PROJECT['tsconfig.app.json']!, '@', 'src') as { text: string };
    expect(addPathAlias(added.text, '@', 'src')).toEqual({ status: 'exists' });
    expect(addPathAlias(added.text, '@', 'app/src')).toEqual({ status: 'conflict', existing: ['./src/*'] });
  });

  it('creates compilerOptions when missing', () => {
    const result = addPathAlias('{}', '~', 'source') as { text: string };
    expect(JSON.parse(result.text)).toEqual({ compilerOptions: { paths: { '~/*': ['./source/*'] } } });
  });
});

describe('addViteAlias', () => {
  const vite = VITE_PROJECT['vite.config.ts']!;
  const options = { alias: '@', srcDir: 'src', useTsconfigPaths: true };

  it('enables resolve.tsconfigPaths on Vite 8+', () => {
    const result = addViteAlias(vite, 'vite.config.ts', options) as { text: string };
    expect(result.text).toBe(`import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
})
`);
    expect(addViteAlias(result.text, 'vite.config.ts', options)).toEqual({ status: 'exists' });
  });

  it('adds resolve.alias and the import on older Vite', () => {
    const result = addViteAlias(vite, 'vite.config.ts', { ...options, useTsconfigPaths: false }) as { text: string };
    expect(result.text).toBe(`import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
`);
    expect(addViteAlias(result.text, 'vite.config.ts', { ...options, useTsconfigPaths: false })).toEqual({
      status: 'exists',
    });
  });

  it('adds to an existing resolve object and handles missing trailing commas', () => {
    const text = 'export default defineConfig({\n  resolve: {\n    dedupe: ["react"]\n  }\n});\n';
    expect((addViteAlias(text, 'vite.config.ts', options) as { text: string }).text).toBe(
      'export default defineConfig({\n  resolve: {\n    dedupe: ["react"],\n    tsconfigPaths: true\n  }\n});\n',
    );
  });

  it('asks for manual setup when the config is not a plain object', () => {
    const text = 'export default defineConfig(({ mode }) => ({ plugins: [] }))';
    expect(addViteAlias(text, 'vite.config.ts', options).status).toBe('manual');
  });
});
