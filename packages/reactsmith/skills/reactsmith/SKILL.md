---
name: reactsmith
description: Builds and changes the structure and UI of a React project that has a reactsmith.config.json, with the ReactSmith CLI instead of editing files by hand. Use for any change to pages, layouts, components, elements, styles, icons or constants in such a project, e.g. "add a settings page", "put a search button in the top bar", "make the active link blue".
---

# ReactSmith

The project is managed by ReactSmith, a CLI that writes the structure and the UI: features, views (pages), layouts, components, the elements inside them, their styles, and constants. `reactsmith check` keeps the structure valid.

## The rule

- **Structure and UI go through commands.** Creating files, adding or removing elements, giving them text or props, and styling them: always a command, never an edit by hand. The commands keep imports, style files, barrels, routes and usages in sync, which hand edits break.
- **Only logic is written by hand:** event handlers, state, hooks, data loading, and variables in a component body. Commands then use these variables by name, e.g. `--props "onClick={toggle}"` or `--text "{user.name}"`.
- **When no command can do it,** read [by-hand.md](by-hand.md) before editing anything.

All commands are in [commands.md](commands.md), with every option. `npx reactsmith help <command>` prints the same for one command.

## The loop

1. Run commands from the project root, as `npx reactsmith <command> … --json`. `--json` never prompts, and returns `ok`, the `actions` (files changed) and the `issues`.
2. When unsure what a command will do, run it with `--dry-run` first: it shows the changes without making them.
3. When `ok` is false, read each issue's `message` and `hint`. The hint says what to do. Fix the cause, then run the same command again. A refused command has changed nothing.
4. At the end, run `npx reactsmith check --json`. Errors must be fixed; warnings say what to clean up (`style-unused`, `component-unused`). After props or interfaces changed, also run `npx tsc -b` (or the project's typecheck script).

## Where things go

- **A page** is a view in a feature: `feature create docs --path /docs`, then `view create Introduction --feature docs --path introduction`. `--index` makes it the feature's page at its base path (`/docs`), and `--path '*'` the page for the URLs under the feature that nothing else matches.
- **The shell** is layouts, nested, each holding only its own part (see [Layouts](#layouts)).
- **A part used across the app** (a top bar's menu, a footer) is an app component: `component create NavMenu --app`.
- **A basic, reusable component** (a button, a card, a badge) is shared, by type: `component create PrimaryButton --type buttons`. Before creating one, look in `src/components/<type>/` for one that already exists. The types are in `componentTypes` in reactsmith.config.json.
- **A component of one domain** (a pricing table of the billing pages) belongs to its feature: `component create PriceTable --feature billing`.
- **Data** (navigation links, cards of a grid) is a constant, as JSON: `constant create NAV_LINKS --app --value '[…]'`, then rendered as a list (see below).

Component names are unique in the project.

## Layouts

A layout is the frame around pages: its parts, and `<Outlet />` where the page goes. Layouts nest, so each one holds only what the layouts around it don't: a page under `/docs` renders inside RootLayout (the top bar), then DocsLayout (the sidebar). `check` warns when a layout repeats a part of a layout around it (`layout-repeats-parent`), because the page would show it twice.

- **The root layout,** around every page: `layout create --topbar` (and `--sidebar` when every page has one). Its parts are app components.
- **A feature's layout,** around that feature's pages only: `layout create --feature docs --sidebar`. It lives in `features/docs/layouts/DocsLayout`, wraps the feature's routes, and its parts are components of the feature. It comes with a not-found page of the feature, so unknown URLs under `/docs` keep the sidebar. New views of the feature go inside it.
- **A layout several features share:** `layout create GuideLayout` in the app, then `feature create guides --layout GuideLayout` for each feature. They share one route, so the layout stays mounted while moving between them.

What `layout create` writes is ready to use: `#root` (a row when it has a sidebar) holds the parts and the page area, `#main` in the root layout (a `<main>` that scrolls) and `#content` in a nested one (a `div` that fills the space under the outer layouts and scrolls on its own, so the sidebar stays in place). It needs no styles for that; `reactsmith tree <layout file>` shows its ids. Change what a layout holds with the element commands, like any component. A part that already exists elsewhere (an app `Sidebar` that only the docs use) moves first: `component update Sidebar --feature docs`.

## Targets: element ids

Element commands take an id: the file from `src/`, `#`, then the element.

- **By name:** `app/components/TopBar/TopBar.tsx#search`. An element's name is its style (`className={styles.search}`). Give every element you will come back to a `--name` when you insert it: its id then stays the same when other elements come and go.
- **The component's outer element** is `root`: `…/TopBar.tsx#root`.
- **By path,** for unnamed elements: `…/TopBar.tsx#root/nav/a[2]` (the second `a` of the `nav`), or from a named element: `…#links/NavLink[3]`. A path shifts when siblings are inserted before it, so prefer names.
- **From a line:** `npx reactsmith id src/app/components/TopBar/TopBar.tsx:12` prints the id of the element at that line.

## Building a piece of UI

Work from the outside in:

1. **Decide the components.** Split the design into components: what repeats becomes a component repeated over a list, what is reused becomes a shared component.
2. **Create them**, with their props and their outer element:
   `component create NavItem --app --interface "label: string; to: string; icon: LucideIcon" --root NavLink --root-props "to={to}"`.
   `--interface "children: React.ReactNode"` makes a wrapper that holds elements where it is used. A component that only shows text (a badge, a label) takes a string prop instead: `--interface "label: string" --root span --text "{label}"`.
   Types in `--interface` are imported from where they are found, like components: another component's props (`items: SidebarLinkProps[]`), the `types/` folders, or a package (`icon: LucideIcon`). A type found nowhere, or in two places, becomes a placeholder in `types.ts`, with a warning.
3. **Insert the elements**, each with `--name`: `element insert span --into "…/NavItem.tsx#root" --text "{label}" --name label`. Elements that hold others (layout and interactive elements, components that take children) take `--direction`, `--gap`, `--align`, `--justify`, `--padding`, in all three commands (`component create`, `element insert`, `style update`); buttons and links stay inline (`inline-flex`).
4. **Add data and lists:** a constant, passed as a prop if needed, then `element insert NavItem --into "…#links" --each NAV_LINKS --as link --key link.to --props "{...link}"`. Only components repeat.
5. **Style:** `style update <id> --css "…"` (or `--object`, or `--class` with Tailwind). `--state hover|focus-visible|active|disabled|current` for browser states, `--when <prop>` or `--when <prop>=<value>` for the component's props. Colors come from the palette (`style palette --primary "#4318FF"`) as CSS variables, e.g. `var(--color-primary)`.

What an element holds depends on its kind:
- **Layout elements** (`div`, `nav`, `header`, `ul`, `li`…) hold elements, not text.
- **Text elements** (`span`, `p`, `h1`…`h6`, `label`) hold only text: `--text`. An icon goes next to the text element, in its container.
- **Interactive elements** (`a`, `button`, `NavLink`) and **table cells** (`td`, `th`) hold both.
- **Components** hold elements only when their props declare `children`.

## Changing what exists

- **Text or props of an element:** `element update <id> --text "…"`, `--props "…"`, `--remove-props "…"`.
- **Wrap elements** in a new one: `element insert div --around <first> --through <last> --name row --direction row`. **Unwrap:** `element remove <id> --keep-children`.
- **Move elements** to another place of the same file, as they are (name, style, props, logic): `element move "…#lead" --into "…#title" --position before`; `--through <last>` moves a run of siblings. A branch of a condition moves with its condition; across files, remove and insert.
- **Remove an element:** `element remove <id>`. Its imports and styles go when nothing else uses them; the files of a removed component stay.
- **Delete a component** nothing uses: `component remove <name>`.
- **Rename a component or change its props,** with every usage: `component update <name> --name …`, `--interface …`, `--remove-interface …`, `--rename-interface old=new`.
- **Move a component to another owner,** with every import: `component update Sidebar --feature docs` (or `--app`, `--type cards`). The components only it uses come along (SidebarGroup, SidebarLink). The move is refused when an import would break the rules, e.g. while the app's RootLayout still renders a Sidebar going into a feature: remove it there first. A rename and a move are two commands.
- **Move a page to another URL:** run `view create` again on the existing view, with `--index` or `--path`: `view create Introduction --feature docs --index`. Only the route changes. Links to the old URL are listed in a warning (`route-old-links`): update them (`constant update`, `element update --props`).
- **Data:** `constant update NAME --value '…'`, `constant remove NAME`.

## Conditions

An element (or a list) shown only sometimes is a condition, written by commands like everything else:

- **New and conditional:** `element insert Badge --into "#root" --props "label='soon'" --if soon` writes `{soon && <Badge … />}`; `--if "!open"` for the opposite; `--fallback label` writes `{label ?? <Placeholder />}`. Works with `--each` too.
- **Existing element into a condition:** `element insert "{?open}" --around "#items"`.
- **The other branch:** `element insert p --into "…#root/{?open}" --text "Closed"` turns `{open && …}` into `{open ? … : <p>Closed</p>}`.
- **Ids:** a condition is `{?test}` in a path (`…#root/{?open}`); the elements it shows keep their names (`#items`).
- **Remove:** `element remove "…/{?open}"` with what it shows, `--keep-children` to keep the element always shown; removing one branch keeps the other.
- **The test is a name:** a prop, a constant or a body variable (`open` from `useState`), with `!` for the opposite. Anything more goes into a variable first (`const hasItems = items.length > 0`). Each branch is one element, one list, or nothing; conditions don't nest.

## Icons

Icons come from the project's icon library (lucide-react) and are inserted like components, always with the `Icon` suffix: `element insert SearchIcon --into "…#search" --position first --props "size={16}"`. An icon passed as a prop is typed `LucideIcon`, given as `--props "icon={WalletIcon}"`, and rendered with `element insert "{icon}" --into …`. A misspelled name gets suggestions.

## Paths in Git Bash

Git Bash on Windows rewrites arguments that start with `/`, so `--path "/"` arrives as a Windows path. Prefix the command with `MSYS_NO_PATHCONV=1`, or use PowerShell.
