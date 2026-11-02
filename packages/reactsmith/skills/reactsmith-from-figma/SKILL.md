---
name: reactsmith-from-figma
description: Builds the UI of a ReactSmith project from its Figma file (the "design.figma" link in reactsmith.config.json), by mapping the file to ReactSmith commands. Use when asked to build, implement or add pages, layouts or components from the Figma design, e.g. "build the docs site from Figma", "implement the Pricing page", "add the new card component from the design".
---

# Building from Figma with ReactSmith

The Figma file follows conventions that already decide the components, their props and their layout: [figma-conventions.md](figma-conventions.md). Your job is to translate it into ReactSmith commands, not to redesign it. Use the `reactsmith` skill for how the commands work (ids, the loop, `check`).

## 1. Read the design

- The file is the `design.figma` link in `reactsmith.config.json`. A link the user gives (often to one node, `?node-id=420-559`) wins for this task; if the config has none, suggest adding it. With no link at all, ask for one and stop.
- **Work from saved exports, in `.reactsmith/figma/`.** Figma limits reads hard: a View or Collab seat, as on the free plan, gets 20 a month, then a lockout of hours or days. So the design is read once into JSON files, and everything after reads those files. Their format is in [export-format.md](export-format.md). In this order:
  1. **Already saved:** if the screens you need are in `.reactsmith/figma/*.json` (their `roots`), use them. No read at all. **Except for an update:** the design has changed since the last export, so an update always starts from a new export of the linked node (the saved one is the version the code was built from, which `diff.mjs` compares with). Check too that a saved export's `fileKey` is the file of the link: an export of another file is not this design.
  2. **The link, through the Figma MCP server,** when you have it (its `use_figma` tool). Take the node from the link (`?node-id=2287-22651` is `2287:22651`; several links, several nodes), set `NODE_IDS` in [export-node.js](export-node.js) to them and `PART = 1`, and pass the whole file as the code of `use_figma` (it only reads; follow the server's instructions for it, e.g. its session). It returns the export, the same as the plugin writes. `use_figma` returns at most 48,000 bytes, so a larger export comes in parts: when the result has `"parts": 3`, run the file again for part 2 and part 3, with `PART` set and `EXPORTED_AT` set to part 1's `exportedAt`. Save each result unchanged before going on: part 1 (or the whole export) as `.reactsmith/figma/<node name>-<node id>-<YYYYMMDD-HHMM>.json`, the others next to it as `…-part2.json`, `…-part3.json`. Every call counts as a read: don't read the design in other ways (screenshots, `get_design_context`).
  3. **The ReactSmith export plugin** (no API, no limit), when there is no MCP server or its reads ran out: ask the user to select the screens in Figma, run the plugin, and save its file in `.reactsmith/figma/`, or paste it to you (save it there yourself).
  4. **The fetch script,** with the user's token: `FIGMA_TOKEN=… node .claude/skills/reactsmith-from-figma/fetch.mjs <link> <link>…`. All the screens in one read, plus one for the components they use; screens already saved are skipped. Pass every screen of the task at once. The API gives the variables' names only on Enterprise plans.
- **Never retry a refused read.** On a rate limit, tell the user when it resets and offer the plugin; don't call again. If no source is available, stop: don't build from memory or from a screenshot.
- `.reactsmith/figma/` is a local copy of the design: suggest adding `.reactsmith/` to `.gitignore`, unless the team wants the snapshot in git.
- Only build what was asked. "The Pricing page" means its view frame, the components it uses that don't exist yet, and nothing else. A link to a component means that component and the components inside it.
- **Screens are their node ids,** the `roots` of the exports and the frames inside them: never trust a file's name, which the user chose.
- **A view's content:** in a full screen (a view frame holding the shell's instances), only what is inside its frame named `main` is the view; otherwise the whole frame is. Never build the shell's instances (`app/TopBar`, `docs/Sidebar`…) into a view: the layouts render them. Content outside `main`, and frames that are not top-level frames of a feature's page (a preview, a copy for review), are not built: report them.
- **The shell is a chain of layouts.** Sort each shell part by the screens it is on (see "Pages and the shell" in the conventions): on every screen, the root layout's; on one feature's screens only, that feature's layout. Compare with the layouts the project has (RootLayout in `app/layouts/`, `<Feature>Layout` in `features/<f>/layouts/`), by component name: what is missing is built, and what a layout has but its screens don't goes under "Not mapped". A part that the project has under another owner moves first (`component update Sidebar --feature docs`), after it has been taken out of the layout that renders it now.
- **What exists is updated, not built again.** Check the project for each component, layout and view first. What is new is built; what exists is compared with the design and updated (see [updating.md](updating.md)); what matches is listed as "exists, unchanged".

## 2. Write the plan

Write `reactsmith-plan.md` at the project root, then **stop and ask the user to review it.** Run nothing before they agree.

The plan has three parts:

1. **Commands,** in the order they will run, each in a code block, grouped by what they build:
   1. tokens: `style palette --set` and `style typography --set` for the variables the screens use that the project lacks;
   2. the root layout, if it doesn't exist: `layout create --topbar` (the parts on every screen), then its app components;
   3. shared components, then app and feature components, each one complete (create, elements, styles) before the next that uses it;
   4. features, then each feature's layout when its screens have parts of their own (`layout create --feature docs --sidebar`, with its not-found page), then its parts' elements, then the views: views created after the layout go inside it. The feature's main page is `view create … --index`, when the request says so;
   5. each view's content, outside in: elements, then data and lists, then styles.

   Each command uses the names of the file: component names from the component paths, `--name` from layer names, props from component properties. Look at the existing code first (`src/components/<type>/`, `src/app/components/`), and reuse what exists instead of creating it again.

   **Updates** of what exists come in their own group, before what is new, one block per component or view: each command with the Figma value and the code's value it replaces, so the review is quick (`#setupTitle: "Set up the project" → "Initialize"`).
2. **Decisions,** a short list of anything the conventions didn't settle and how you settled it. Keep it short: if it grows long, the file breaks the conventions and the user should know.
3. **Not mapped,** what breaks the conventions or can't be built with commands (see "Not supported yet" in the conventions), with the Figma layer and what the developer has to do by hand.

## 3. Apply it

Once the user agrees:

- Run the commands in order, with `--json`. When one is refused, read the hint, fix the command (in the plan too), and go on. A refused command changed nothing.
- Don't skip ahead: a later command often targets an element an earlier one created.
- Don't write markup or styles by hand to work around a refusal. If no command can do it, add it to "Not mapped" and tell the user.
- At the end, run `npx reactsmith check --json` and the typecheck, and report what was built, what was decided, and what is left by hand.

## Mapping at a glance

The full rules are in [figma-conventions.md](figma-conventions.md).

| Figma | ReactSmith |
|---|---|
| Component `buttons/PrimaryButton` | `component create PrimaryButton --type buttons` |
| Component `app/TopBar` / `docs/PriceTable` | `--app` / `--feature docs` |
| Frame `RootLayout`, or the shell parts on every screen | the root layout (`layout create --topbar`, then its app components) |
| Frame `DocsLayout`, or the shell parts only on the `docs` screens | the feature's layout (`layout create --feature docs --sidebar`), its parts `docs/…` |
| Top-level frame `Quick start` on the page `docs` | `feature create docs --path /docs` (if new), `view create QuickStart --feature docs --path quick-start`; its content is what is inside `main` (full screen) or the whole frame |
| `root: button` in a component's description | `--root button` |
| Instance | `element insert <Component> --props "…"` |
| Frame with auto layout | layout element: `--direction`, `--gap px÷4`, `--padding px÷4`, `--align`, `--justify` |
| Layer name `nav: links` | `element insert nav … --name links` |
| Text layer | `span` (or its tag) with `--text` |
| Text property | `label: string` + `--text "{label}"` |
| Variant `true/false` | `boolean` prop + `style update --when` |
| Variant | union prop + `style update --when name=value` |
| Boolean property hiding a layer | `boolean` prop + `element insert … --if soon` (or `"{?soon}" --around`) |
| Slot property | `children`, or a list prop when every use holds one component (see "Slots and data") |
| Instance swap of an icon | `icon: LucideIcon` + `element insert "{icon}"` |
| lucide icon `chevron-down` | `element insert ChevronDownIcon` |
| Repeated instances | a constant + `element insert <Component> --each` |
| Color variable `Text/Default/Secondary` | `style palette --set "text/default/secondary=#…"`, `var(--color-text-default-secondary)` |
| Typography variable `Heading/Size Base` (a size) | `style typography --set "size/heading/size-base=…"`, `var(--text-heading-size-base)` |
| Fills, strokes, radius, text style | `style update --css "…"` |
