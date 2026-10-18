import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { STYLE_FILE_SUFFIXES } from '../config/defaults.js';
import type { ResolvedConfig } from '../config/types.js';
import type { Issue } from '../issues.js';
import { componentEntryProblems, componentFileProblems } from './component-file.js';
import { textPlacementIssues } from './text.js';

const FREE_FILE = /\.(test|spec|stories)\.[jt]sx?$/;

/** How many times the file renders React Router's <Outlet />, where the pages appear. */
function outletCount(text: string, fileName: string): number {
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let count = 0;
  const visit = (node: ts.Node): void => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(sourceFile) === 'Outlet') count++;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return count;
}

/** Checks the app's layouts: each in its own folder, a clean layout file rendering one <Outlet />, and its entry point. */
export async function checkLayouts(root: string, config: ResolvedConfig, issues: Issue[]): Promise<void> {
  if (!config.folders.app || !config.appFolders.layouts) return;
  const layoutsRel = `${config.srcDir}/${config.folders.app}/${config.appFolders.layouts}`;
  const entries = await readdir(path.join(root, layoutsRel), { withFileTypes: true }).catch(() => undefined);

  for (const entry of (entries ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
    const entryRel = `${layoutsRel}/${entry.name}`;
    if (!entry.isDirectory()) {
      issues.push({
        severity: 'error',
        code: 'layout-not-in-folder',
        path: entryRel,
        message: `"${entry.name}" is directly in ${layoutsRel}/, but each layout lives in its own folder.`,
        hint: `Move it to ${layoutsRel}/${entry.name.replace(/\.[^.]+$/, '')}/ with an index.ts exporting it.`,
      });
      continue;
    }

    const name = entry.name;
    const allowed = [`${name}.tsx`, `${name}${STYLE_FILE_SUFFIXES[config.styles]}`, 'index.ts'];
    for (const child of await readdir(path.join(root, entryRel), { withFileTypes: true })) {
      if (child.isFile() && (allowed.includes(child.name) || FREE_FILE.test(child.name))) continue;
      issues.push({
        severity: 'error',
        code: 'layout-unexpected-file',
        path: `${entryRel}/${child.name}`,
        message: `"${child.name}" is not allowed in layout "${name}".`,
        hint: `A layout folder holds ${allowed.join(', ')}, tests and stories. Put the parts of the layout in app components.`,
      });
    }

    const fileRel = `${entryRel}/${name}.tsx`;
    const text = await readFile(path.join(root, fileRel), 'utf8').catch(() => undefined);
    if (text === undefined) {
      issues.push({ severity: 'error', code: 'layout-file-missing', path: entryRel, message: `Layout folder "${name}" has no ${name}.tsx.`, hint: 'The layout file is named like its folder.' });
    } else {
      issues.push(...textPlacementIssues(root, config, fileRel, text));
      for (const problem of componentFileProblems(text, `${name}.tsx`, name)) {
        issues.push({ severity: 'error', code: 'layout-file-content', path: fileRel, message: problem, hint: 'A layout file holds only the layout component; put its parts in app components.' });
      }
      const outlets = outletCount(text, `${name}.tsx`);
      if (outlets !== 1) {
        issues.push({
          severity: 'error',
          code: 'layout-outlet',
          path: fileRel,
          message: `Layout "${name}" renders <Outlet /> ${outlets} times, but the pages need exactly one place.`,
          hint: 'Render <Outlet /> (from "react-router") once, where the pages should appear.',
        });
      }
    }

    const indexRel = `${entryRel}/index.ts`;
    const indexText = await readFile(path.join(root, indexRel), 'utf8').catch(() => undefined);
    if (indexText === undefined) {
      issues.push({ severity: 'error', code: 'layout-entry-missing', path: entryRel, message: `Layout folder "${name}" has no index.ts.`, hint: `Add index.ts with "export { ${name} } from './${name}';".` });
    } else {
      for (const problem of componentEntryProblems(indexText, 'index.ts', name)) {
        issues.push({ severity: 'error', code: 'layout-entry-invalid', path: indexRel, message: problem, hint: `It should only contain "export { ${name} } from './${name}';".` });
      }
    }
  }
}
