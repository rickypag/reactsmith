import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ChangeSet } from '../../src/shared/changes.js';
import { CONFIG_FILE } from '../../src/shared/config/defaults.js';
import { planConfigUpdate } from '../../src/shared/config/write.js';
import { createProject, exists, read } from '../helpers.js';

describe('ChangeSet', () => {
  it('writes nothing until apply, and reads planned changes', async () => {
    const root = await createProject({ 'a.txt': 'old', 'b.txt': 'b' });
    const changes = new ChangeSet(root);
    changes.write('a.txt', 'new', { type: 'update', message: '' });
    changes.write('dir/c.txt', 'c', { type: 'create', message: '' });
    changes.move({ from: path.join(root, 'b.txt'), to: path.join(root, 'moved/b.txt') });

    expect(await changes.read('a.txt')).toBe('new');
    expect(await changes.read('moved/b.txt')).toBe('b');
    expect(await changes.read('b.txt')).toBeUndefined();
    expect(await read(root, 'a.txt')).toBe('old');
    expect(await exists(root, 'dir/c.txt')).toBe(false);

    await changes.apply();
    expect(await read(root, 'a.txt')).toBe('new');
    expect(await read(root, 'dir/c.txt')).toBe('c');
    expect(await read(root, 'moved/b.txt')).toBe('b');
    expect(await exists(root, 'b.txt')).toBe(false);
  });
});

describe('planConfigUpdate', () => {
  async function update(initial: string | undefined, values: Record<string, unknown>) {
    const root = await createProject(initial === undefined ? {} : { [CONFIG_FILE]: initial });
    const changes = new ChangeSet(root);
    await planConfigUpdate(changes, values);
    return { text: await changes.read(CONFIG_FILE), actions: changes.actions.map((a) => `${a.type} ${a.message}`) };
  }

  it('creates the file', async () => {
    const { text, actions } = await update(undefined, { appFiles: 'app' });
    expect(JSON.parse(text!)).toEqual({ appFiles: 'app' });
    expect(actions).toEqual(['create with "appFiles": "app"']);
  });

  it('updates a key and keeps the rest of the file', async () => {
    const initial = '{\n  // my settings\n  "srcDir": "src"\n}\n';
    const { text, actions } = await update(initial, { appFiles: 'root' });
    expect(text).toContain('// my settings');
    expect(text).toContain('"appFiles": "root"');
    expect(actions).toEqual(['update set "appFiles": "root"']);
  });

  it('skips when the value is already set', async () => {
    const { actions } = await update('{ "appFiles": "app" }', { appFiles: 'app' });
    expect(actions).toEqual(['skip already sets "appFiles": "app"']);
  });
});
