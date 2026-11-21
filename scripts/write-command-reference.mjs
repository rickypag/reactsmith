// Writes the skill's command reference from the built CLI, so it always matches the commands' definitions.
import { writeFile } from 'node:fs/promises';
import { COMMANDS } from '../dist/commands/index.js';
import { commandReference } from '../dist/hosts/cli/reference.js';

await writeFile(new URL('../skills/reactsmith/commands.md', import.meta.url), commandReference(COMMANDS));
