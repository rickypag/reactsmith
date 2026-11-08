import type { RuleExample } from '../types.js';

/** Every code the rule reports. Each one has at least one example. */
export const codes = ['alias-not-configured', 'alias-mismatch'] as const;

const config = { appFiles: 'app', alias: '@' };

export const examples: RuleExample[] = [
  {
    title: 'The alias set up in tsconfig',
    config,
    tree: { 'tsconfig.app.json': JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } }) },
    issues: [],
  },
  {
    title: 'The alias missing from tsconfig',
    config,
    tree: { 'tsconfig.app.json': JSON.stringify({ compilerOptions: {} }) },
    issues: ['warning alias-not-configured tsconfig.app.json'],
  },
  {
    title: 'The alias pointing somewhere else in tsconfig',
    config,
    tree: { 'tsconfig.app.json': JSON.stringify({ compilerOptions: { paths: { '@/*': ['./lib/*'] } } }) },
    issues: ['warning alias-mismatch tsconfig.app.json'],
  },
];
