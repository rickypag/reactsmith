## ReactSmith

This project's structure and UI are managed by ReactSmith. For any change to pages, layouts, components, elements, styles, icons or constants, use the `reactsmith` skill: it turns one precise request into commands (`npx reactsmith … --json`). When a request describes its targets loosely ("the second element in the card"), use the `reactsmith-resolver` skill first to find the exact ids. Don't edit those files by hand unless asked to, after the skill says no command does it; run `npx reactsmith check` when done.

To build from the design (`design.figma` in `reactsmith.config.json`), use the `reactsmith-from-figma` skill: it writes `reactsmith-plan.md` for review before running anything.
