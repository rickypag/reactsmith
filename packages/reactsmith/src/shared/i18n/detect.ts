import { stat } from 'node:fs/promises';
import type { ChangeSet } from '../changes.js';
import { CONFIG_FILE, I18N_LIBRARIES, I18N_PRESETS } from '../config/defaults.js';
import type { I18nConfig, ResolvedConfig } from '../config/types.js';
import { dependencyMajor } from '../dependencies.js';
import { listLocales } from './messages.js';

/** Where next-intl's setup says the default language: defineRouting({ defaultLocale: 'it' }), or its middleware. */
const SETUP_FILES = ['i18n/routing.ts', 'i18n/request.ts', 'i18n.ts', 'middleware.ts', 'i18n/routing.js', 'middleware.js'];

/** The folders the message files usually live in, from the project root. */
const MESSAGE_FOLDERS = (srcDir: string) => ['messages', `${srcDir}/messages`];

/**
 * The translation settings to save in the config: undefined when the config has them, or no supported library is
 * installed. The library's setup is the dev's; init only records where its message files are and the default
 * language, from that setup or the only message file. Without a default language, it says what to set.
 */
export async function planI18nDetection(changes: ChangeSet, config: ResolvedConfig): Promise<I18nConfig | undefined> {
  if (config.i18n) return undefined;
  let library: (typeof I18N_LIBRARIES)[number] | undefined;
  for (const candidate of I18N_LIBRARIES) if ((await dependencyMajor(changes.root, candidate)) !== undefined) library = candidate;
  if (!library) return undefined;

  const preset = I18N_PRESETS[library];
  let messages: string = preset.messages;
  for (const folder of MESSAGE_FOLDERS(config.srcDir)) {
    if (await stat(changes.resolve(folder)).catch(() => undefined)) {
      messages = `${folder}/{locale}.json`;
      break;
    }
  }

  let defaultLocale: string | undefined;
  for (const file of SETUP_FILES.flatMap((name) => [`${config.srcDir}/${name}`, name])) {
    const text = await changes.read(file);
    const found = text && /\bdefaultLocale\s*:\s*['"]([A-Za-z0-9-]+)['"]/.exec(text)?.[1];
    if (found) {
      defaultLocale = found;
      break;
    }
  }
  if (!defaultLocale) {
    const locales = (await listLocales(changes.root, { library, messages, defaultLocale: '' })).filter(Boolean);
    if (locales.length === 1) defaultLocale = locales[0];
  }
  if (!defaultLocale) {
    changes.skip(
      'package.json',
      `${library} found, but not the default language: set "i18n" in ${CONFIG_FILE}, e.g. { "library": "${library}", "messages": "${messages}", "defaultLocale": "en" }`,
    );
    return undefined;
  }
  return { library, messages, defaultLocale };
}
