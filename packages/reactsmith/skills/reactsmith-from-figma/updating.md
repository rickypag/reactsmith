# Updating what exists from the design

When a view or a component of the export already exists in the project, compare the two and plan the commands that bring the code to the design. The design wins for structure, texts and props; the code keeps everything the design doesn't describe (logic, conditions' tests, routes, props added by earlier plans such as `to` or `onClick`).

Compare one view or component at a time: for a view, the content of the frame (inside `main` for a full screen) against the view's file; for a component, its definition against its file. Read the file in the project, not a memory of it.

## With the previous export: diff.mjs

Exports are kept with their date and time, so when the screen was exported before, the comparison is exact: only what changed **in the design** between the two exports is applied, and what the code does differently on purpose (links, handlers, earlier decisions) is never touched. Run:

```sh
node .claude/skills/reactsmith-from-figma/diff.mjs <node id> <file built from it>
# e.g. node .claude/skills/reactsmith-from-figma/diff.mjs 440:242 src/features/docs/views/InstallationView/InstallationView.tsx
```

It reads the two latest exports of the screen and the file's elements (`reactsmith tree --json`), and prints the **commands** (removed and new elements, moves, texts, instance values, style values) and the **decisions** it leaves to you: new frames, unnamed layers, texts shown from a value. Copy the commands into the plan's Updates, with the reasons it gives; settle the decisions with the rules below. A change the code already has is not repeated, so running it again is harmless.

Without a previous export (the first update after a build), compare by reading, as below.

## Matching layers to elements

The conventions link them by name:

- **A named layer is the element with that name:** the layer `h2: setupTitle` is the element `className={styles.setupTitle}`, id `…#setupTitle`. The tag before the colon must match too.
- **An instance is the element of that component,** by its layer name (`install` is `<CodeBlock className={styles.install} … />`), or, without a name, by its place among the instances of the same component.
- **A component's outer frame is `#root`.**
- **An unnamed layer** is matched by its tag and its place between named neighbors. If that leaves a doubt, don't guess: list it under "Not mapped".

## What to compare, and the command for each

| Difference | Command |
|---|---|
| An element the design no longer has | `element remove <id>` (its style goes too) |
| A layer the code doesn't have | `element insert … --into <parent> --position before\|after <named neighbor>`, with its name and style, as for a new element |
| The same elements in another order | `element move <id> --into <neighbor> --position before\|after`, one move per element out of place |
| A layer moved into another frame of the same file | `element move <id> --into <new parent>` |
| A text | `element update <id> --text "…"` |
| A value set on an instance (text, variant, icon) | `element update <id> --props "…"` |
| A component property added, removed or renamed | `component update <Name> --interface "…"`, `--remove-interface …`, `--rename-interface old=new` |
| A new component | `component create`, as when building |
| A component the design no longer has, and nothing uses | `component remove <Name>` (only when the user asked to clean up) |

**Styles:** compare the values the design sets clearly (auto layout gap and padding, sizes, colors by variable, font size and weight, radius, borders) with the element's rule, and update only what differs: `style update <id> --css "gap: 16px"` with the changed declarations alone. Put style changes in their own list in the plan: values can differ only by rounding (`0.5rem` and `8px`), so mention both values and skip differences that aren't real.

## The shell

The parts around `main` are the layouts' (see "Pages and the shell" in the conventions). When they change in the design, the layout changes, never the views:

- **A part added to or gone from all the screens of a feature** (or all screens): `element insert` or `element remove` in that feature's layout (or in RootLayout).
- **A part that now shows on more screens** (the sidebar on every page, not only the docs): it goes up a layout. Remove it from the inner one, move its component to the outer one's owner (`component update Sidebar --app`), and insert it there.
- **A feature that now has parts of its own,** and no layout: `layout create --feature <f>` with them.

## What the update doesn't touch

- **Logic:** handlers, state, hooks, conditions' tests and hand-written code stay. If the design changes what a condition shows (a layer hidden in another state), report it.
- **What the design doesn't describe:** routes, links' targets, props added by earlier plans (`to`, `onClick`, `aria-label`), extra elements written by hand. Remove an element only when it has a name the design used to have, or the user asks.
- **Elements across files:** a layer moved from one component into another can't move: list it under "Not mapped" (remove it there, insert it here).

## In the plan

Under **Updates**, one block per view or component, each command with the old and the new value:

```
### InstallationView (Figma: Installation, 440:242)
- #lead: removed in the design
  npx reactsmith element remove "features/docs/views/InstallationView/InstallationView.tsx#lead"
- #setupTitle: "Set up the project" → "Initialize"
  npx reactsmith element update "features/docs/views/InstallationView/InstallationView.tsx#setupTitle" --text "Initialize"
```

What matches is listed as "exists, unchanged". Differences you are not sure about go under "Decisions" or "Not mapped", never into commands.
