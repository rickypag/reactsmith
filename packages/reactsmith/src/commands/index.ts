import type { Command } from '../core/command.js';
import { checkCommand } from './check/command.js';
import { initCommand } from './init/command.js';

/**
 * ReactSmith's commands, in the order shown in the help. Adding a command means adding it here.
 * The built-in help and version commands are added by runCli.
 */
export const COMMANDS: Command[] = [initCommand, checkCommand];
