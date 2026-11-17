## ReactSmith

This project's structure and UI are managed by ReactSmith: pages, layouts, components, the elements inside them, their props, styles, icons, constants and messages. Change those with the `reactsmith` skill: it turns one precise request into commands (`./node_modules/.bin/reactsmith … --json`). A whole component, new or redone, is one call: its JSX as a draft (`component create <Name> … --jsx -`, or `--replace`; see `.claude/skills/reactsmith/drafts.md`), not one command per element. When a request describes its targets loosely ("the second element in the card"), use the `reactsmith-resolver` skill first to find the exact ids.

**Logic is written by hand**, without asking and without trying a command first: state, effects, handlers, hooks, derived values, helpers in `utils/`, types in `types/`, data loading, and the framework's own files (in Next.js, `page.tsx`, `layout.tsx` and route handlers in `src/app`). A UI change the skill says no command does (`unsupported`) may be written by hand too. A refused command is different: fix the command from its hint, don't work around it by hand.

**Planning:** read `.claude/skills/reactsmith/limits.md` first, so the design fits what the commands can do. To check a whole plan before showing it, run its commands with `./node_modules/.bin/reactsmith batch --dry-run --json`: on a copy of the project, it reports every refusal and what `check` would find, and changes nothing.

Before writing by hand, read the skill's `by-hand.md` (`.claude/skills/reactsmith/by-hand.md`): it says where each thing goes and what `check` refuses. Run `./node_modules/.bin/reactsmith check` after: a hand change is fine as long as it passes.

To build from the design (`design.figma` in `reactsmith.config.json`), use the `reactsmith-from-figma` skill: it writes `reactsmith-plan.md` for review before running anything.
