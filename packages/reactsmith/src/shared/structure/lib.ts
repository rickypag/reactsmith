import type { ResolvedConfig } from '../config/types.js';

/**
 * Whether a file is in the lib folder (src/lib). lib holds plain code outside the UI (an API client, an LLM call, data
 * logic), which ReactSmith doesn't manage: check reports nothing there, and the commands don't look at its files.
 */
export function isInLib(config: ResolvedConfig, fileRel: string): boolean {
  const lib = config.folders.lib;
  return lib !== undefined && fileRel.startsWith(`${config.srcDir}/${lib}/`);
}
