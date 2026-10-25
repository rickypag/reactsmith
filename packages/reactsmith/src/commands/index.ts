import type { Command } from '../core/command.js';
import { checkCommand } from './check/command.js';
import { componentCreateCommand } from './component/create/command.js';
import { componentUpdateCommand } from './component/update/command.js';
import { constantCreateCommand } from './constant/create/command.js';
import { constantRemoveCommand } from './constant/remove/command.js';
import { constantUpdateCommand } from './constant/update/command.js';
import { elementInsertCommand } from './element/insert/command.js';
import { elementRemoveCommand } from './element/remove/command.js';
import { elementUpdateCommand } from './element/update/command.js';
import { featureCreateCommand } from './feature/create/command.js';
import { iconInsertCommand } from './icon/insert/command.js';
import { idCommand } from './id/command.js';
import { initCommand } from './init/command.js';
import { layoutCreateCommand } from './layout/create/command.js';
import { stylePaletteCommand } from './style/palette/command.js';
import { styleUpdateCommand } from './style/update/command.js';
import { viewCreateCommand } from './view/create/command.js';

/**
 * ReactSmith's commands, in the order shown in the help. Adding a command means adding it here.
 * The built-in help and version commands are added by runCli.
 */
export const COMMANDS: Command[] = [
  initCommand,
  checkCommand,
  featureCreateCommand,
  viewCreateCommand,
  layoutCreateCommand,
  componentCreateCommand,
  componentUpdateCommand,
  elementInsertCommand,
  elementUpdateCommand,
  elementRemoveCommand,
  iconInsertCommand,
  constantCreateCommand,
  constantUpdateCommand,
  constantRemoveCommand,
  stylePaletteCommand,
  styleUpdateCommand,
  idCommand,
];
