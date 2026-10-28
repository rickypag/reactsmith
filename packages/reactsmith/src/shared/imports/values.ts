import ts from 'typescript';
import type { ChangeSet } from '../changes.js';
import { addNamedImport } from '../code/insert.js';
import type { ResolvedConfig } from '../config/types.js';
import { componentNames } from '../values/scope.js';
import { findComponentSource } from './lookup.js';

/** A component's name, as opposed to a constant's: "LayoutDashboardIcon", not "NAVIGATION". */
const COMPONENT_NAME = /^[A-Z][a-z]\w*$/;

/**
 * Imports the components that values pass by name, `icon={LayoutDashboardIcon}`, when the file doesn't have them yet:
 * found like the components "element insert" inserts, the icon library included. Other names are left to the
 * usual checks (props, constants, imports).
 */
export async function importComponentValues(changes: ChangeSet, config: ResolvedConfig, file: string, text: string, component: string, names: string[], constants: Map<string, string>): Promise<string> {
  let updated = text;
  for (const name of names) {
    if (!COMPONENT_NAME.test(name) || constants.has(name)) continue;
    const scope = componentNames(ts.createSourceFile(file, updated, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), component);
    if (!scope || scope.inScope.has(name) || scope.props.has(name)) continue;
    const source = await findComponentSource(changes, config, file, updated, name);
    updated = addNamedImport(updated, file, name, source.specifier);
  }
  return updated;
}
