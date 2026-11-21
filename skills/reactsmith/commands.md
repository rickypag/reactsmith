# ReactSmith commands

<!-- Generated from the CLI's command definitions by "npm run build". Do not edit: changes are lost. -->

Every command takes these options. Use `--json` when a program reads the output: it never prompts.

- `--cwd <dir>`: Project root (default: current directory)
- `--json`: Print machine-readable JSON (never prompts)
- `-h, --help`: Show help for the command

## init

```
reactsmith init
```

Set up the project: config, App files, import alias, the skill for Claude Code, then check.

Options:

- `--app-files <app|root>`: Move App.* into the app folder, or keep them in the source root
- `--styles <css-modules|tailwind>`: How the commands write styles: CSS Modules (Name.module.css, the default) or Tailwind classes (Name.styles.ts); asked when Tailwind is installed
- `-y, --yes`: Use the defaults instead of asking
- `--no-skills`: Leave out the ReactSmith skill for Claude Code (.claude/skills/reactsmith) and its block in CLAUDE.md; run init again without it to add them later
- `--dry-run`: Show what would change without writing anything

## check

```
reactsmith check
```

Validate the project structure against reactsmith.config.json.

## feature create

```
reactsmith feature create <name>
```

Create a feature: its public API and, with a router, an empty routes file mounted in the app router. Safe to run again: an existing feature is only mounted if it is not yet.

Arguments:

- `name`: Feature name, e.g. "user-profile"

Options:

- `--path <path>`: The route path: of a view inside its feature, e.g. "settings", ":id", or "*" for the pages no other route matches; of a feature, its base path, or "/" for the root (default: asked, or the name)
- `--no-mount`: Do not add the feature to the app router
- `--layout <name>`: Mount it inside this app layout, e.g. "DocsLayout": features under one layout share its route; a mounted feature moves there
- `--dry-run`: Show what would change without writing anything

## view create

```
reactsmith view create <name>
```

Create a view in a feature and add its route to the feature's routes. Safe to run again: for an existing view, --index or --path moves its route, and nothing else changes.

Arguments:

- `name`: View name; the view suffix ("viewSuffix" in the config, View by default) is added when missing: "Settings" and "SettingsView" both create SettingsView

Options:

- `--feature <name>`: The feature it belongs to (required)
- `--path <path>`: The route path: of a view inside its feature, e.g. "settings", ":id", or "*" for the pages no other route matches; of a feature, its base path, or "/" for the root (default: asked, or the name)
- `--index`: Make the view the feature's index route
- `--loader`: Also create a loader that loads data with the page
- `--empty`: Create the view with only its root, without the placeholder heading: for a view you fill right away
- `--dry-run`: Show what would change without writing anything

## layout create

```
reactsmith layout create [name]
```

Create a layout, optionally with a top bar and a sidebar: without a name, the root layout that every page renders in; with a name, a nested layout, which features are mounted into ("feature create --layout"); with --feature, the layout of that feature's pages.

Arguments:

- `name`: The layout's name, e.g. "DocsLayout" (default: RootLayout, or "<Feature>Layout" with --feature)

Options:

- `--feature <name>`: The feature it belongs to
- `--topbar`: Add a top bar (the TopBar component of the layout's owner)
- `--sidebar`: Add a sidebar (the Sidebar component of the layout's owner)
- `--dry-run`: Show what would change without writing anything

## component create

```
reactsmith component create <name>
```

Create a component in a feature, in the app, or shared by type (buttons, cards…), with its style file.

Arguments:

- `name`: Component name, e.g. "Sidebar"

Options:

- `--feature <name>`: The feature it belongs to
- `--app`: It belongs to the app, not to a feature: e.g. parts of the layout, or data the whole app uses
- `--type <type>`: Create a shared component of this type instead, e.g. buttons: src/components/buttons/<Name>
- `--interface <members>`: Props of the component, as TypeScript interface members, e.g. "label: string; size?: 'sm' | 'lg' = 'md'" (an optional prop takes a default after "="); an update adds them or changes those that exist, creating the interface if the component has none
- `--root <name>`: The root element: any HTML tag (default: div) or component, e.g. "button" or "NavLink" when the component is just that
- `--from <source>`: Where a component comes from, when its name is not enough: "app", a feature, "shared", or a package
- `--root-props <props>`: Props the root gets, as JSX attributes, e.g. "to={href}" passes the prop href on: values are literals or variables
- `--text <text>`: The text of a text or interactive element; "{label}" shows a prop, constant or import, e.g. "Hello, {user.name}!"
- `--direction <row|column>`: How it lays out its children: in a row or a column
- `--gap <step>`: Space between its children, in steps of 0.25rem: 2 is 8px
- `--align <start|center|end|stretch>`: Alignment of its children across the direction
- `--justify <start|center|end|between>`: Distribution of its children along the direction
- `--padding <steps>`: Space inside it: one step for all sides ("4"), or vertical and horizontal ("2 4")
- `--jsx <file>`: The whole component as the JSX it returns, from a file or "-" for stdin, with $ attributes for its styles ($name, $gap, $css…): checked before anything is written
- `--replace`: With --jsx: replace what an existing component returns, and its styles, keeping its props and the code before the return
- `--dry-run`: Show what would change without writing anything

## component update

```
reactsmith component update <target>
```

Update a component: rename it, move it to another owner (with the components only it uses), or change its props (interface), updating its files and every usage.

Arguments:

- `target`: The component: its name, e.g. "Card", or its folder, e.g. "src/components/cards/Card"

Options:

- `--name <name>`: A new name: renames the folder, the files, the code and every usage
- `--interface <members>`: Props of the component, as TypeScript interface members, e.g. "label: string; size?: 'sm' | 'lg' = 'md'" (an optional prop takes a default after "="); an update adds them or changes those that exist, creating the interface if the component has none
- `--remove-interface <names>`: Props to remove, e.g. "elevated": refused while the component or a usage still uses them; removing the last one removes the interface
- `--rename-interface <old=new>`: Props to rename in the interface, the component and every usage, e.g. "label=title"
- `--default <value>`: The value existing usages get for a new required prop, written as in JSX: a string in quotes ("'md'"), anything else in braces ("{false}", "{null}", "{2}"). A function has no default: add it as optional instead
- `--feature <name>`: The feature it belongs to
- `--app`: It belongs to the app, not to a feature: e.g. parts of the layout, or data the whole app uses
- `--type <type>`: Move it to this type of shared components, e.g. buttons: src/components/buttons/<Name>
- `--dry-run`: Show what would change without writing anything

## component remove

```
reactsmith component remove <target>
```

Delete a component that nothing uses, with its folder; a shared component leaves the barrel of its type too.

Arguments:

- `target`: The component: its name, e.g. "Card", or its folder, e.g. "src/components/cards/Card"

Options:

- `--dry-run`: Show what would change without writing anything

## element insert

```
reactsmith element insert <name>
```

Insert an HTML element or a component (of the project or of a package) into a component, view or layout, or around elements to wrap them; "{?open}" --around puts an element in a condition.

Arguments:

- `name`: What to insert: an HTML tag ("div", "span", "a", "img"…), a component ("NavMenu", "NavLink"…), a prop holding a component ("{icon}"), or a condition ("{?open}", with --around)

Options:

- `--into <target>`: Where: an element id, or "path/to/File.tsx:line[:column]"
- `--position <inside|first|before|after>`: Last child of --into (inside, the default), first child, or a sibling before or after it
- `--around <target>`: Instead of --into: wrap this element in the new one, which takes its place
- `--through <target>`: The last of a run of siblings: from the target (or the --around element) through this one, in the order of the code
- `--from <source>`: Where a component comes from, when its name is not enough: "app", a feature, "shared", or a package
- `--props <props>`: Props as JSX attributes, e.g. 'to="/docs"' or "to={href}", each replacing the one of the same name: values are literals, variables of the file, or in a translated app the component's messages, e.g. "aria-label={t('menu')}"
- `--text <text>`: The text of a text or interactive element; "{label}" shows a prop, constant or import, e.g. "Hello, {user.name}!"
- `--message <key>`: Instead of --text, a translated message of the component's group, e.g. "workshops" for TopBar shows {t('workshops')}: its text is "TopBar.workshops" in the message files (add it with "messages --set")
- `--name <style>`: The style of the element, e.g. "brand": its class (className={styles.brand}), its rule in the style file, and its id
- `--direction <row|column>`: How it lays out its children: in a row or a column
- `--gap <step>`: Space between its children, in steps of 0.25rem: 2 is 8px
- `--align <start|center|end|stretch>`: Alignment of its children across the direction
- `--justify <start|center|end|between>`: Distribution of its children along the direction
- `--padding <steps>`: Space inside it: one step for all sides ("4"), or vertical and horizontal ("2 4")
- `--if <name>`: Show it only when a prop or variable holds, e.g. --if open ({open && …}), or --if "!open" for the opposite
- `--fallback <name>`: Show the value of a prop or variable, and this element when it is missing, e.g. --fallback label ({label ?? …})
- `--each <list>`: Repeat a component for each item of a list, e.g. --each links (needs --as and --key)
- `--as <name>`: The name of each item, usable in --key and --props, e.g. --as link
- `--key <path>`: A unique value of each item, React's key, e.g. --key link.href
- `--dry-run`: Show what would change without writing anything

## element update

```
reactsmith element update <target>
```

Update an element's text or props (set or remove), which can use variables of the file such as props.

Arguments:

- `target`: The element: an id, or "path/to/File.tsx:line[:column]"

Options:

- `--text <text>`: The text of a text or interactive element; "{label}" shows a prop, constant or import, e.g. "Hello, {user.name}!"
- `--message <key>`: Instead of --text, a translated message of the component's group, e.g. "workshops" for TopBar shows {t('workshops')}: its text is "TopBar.workshops" in the message files (add it with "messages --set")
- `--props <props>`: Props as JSX attributes, e.g. 'to="/docs"' or "to={href}", each replacing the one of the same name: values are literals, variables of the file, or in a translated app the component's messages, e.g. "aria-label={t('menu')}"
- `--remove-props <names>`: Props to remove, by name, e.g. "label elevated"; "children" empties the element
- `--dry-run`: Show what would change without writing anything

## element move

```
reactsmith element move <target>
```

Move an element, with everything inside it, to another place of the same file; its name, style, props, text and logic stay as they are.

Arguments:

- `target`: The element: an id, or "path/to/File.tsx:line[:column]"

Options:

- `--into <target>`: Where: an element id, or "path/to/File.tsx:line[:column]" (required)
- `--position <inside|first|before|after>`: Last child of --into (inside, the default), first child, or a sibling before or after it
- `--through <target>`: The last of a run of siblings: from the target (or the --around element) through this one, in the order of the code
- `--dry-run`: Show what would change without writing anything

## element remove

```
reactsmith element remove <target>
```

Remove an HTML element, a component or a list, with everything inside it (or keeping it, to unwrap it); imports and styles nothing else uses go too (component files are kept: see "component remove").

Arguments:

- `target`: The element: an id, or "path/to/File.tsx:line[:column]"

Options:

- `--keep-children`: Remove only the element: its content takes its place (unwrap it), and its style goes when nothing else uses it
- `--dry-run`: Show what would change without writing anything

## constant create

```
reactsmith constant create <name>
```

Create a constant holding plain data (JSON) in the app's, a feature's or a component's constants.ts.

Arguments:

- `name`: Constant name, unique in the project, e.g. "NAVIGATION"

Options:

- `--app`: It belongs to the app, not to a feature: e.g. parts of the layout, or data the whole app uses
- `--feature <name>`: The feature it belongs to
- `--component <folder>`: In the constants of one component, e.g. app/components/Sidebar
- `--value <json>`: The value as JSON, e.g. 20, '"Docs"' or '[{"label":"Home","href":"/"}]'
- `--file <path>`: A JSON file with the value, e.g. navigation.json
- `--type <type>`: The TypeScript type of the value, e.g. "Plan[]" (a type of the types/ folders, not the props of a component), imported from where it is found; the value is checked against it
- `--dry-run`: Show what would change without writing anything

## constant update

```
reactsmith constant update <name>
```

Replace the value of a constant with new plain data (JSON).

Arguments:

- `name`: The constant, e.g. "NAVIGATION"

Options:

- `--app`: It belongs to the app, not to a feature: e.g. parts of the layout, or data the whole app uses
- `--feature <name>`: The feature it belongs to
- `--component <folder>`: In the constants of one component, e.g. app/components/Sidebar
- `--value <json>`: The value as JSON, e.g. 20, '"Docs"' or '[{"label":"Home","href":"/"}]'
- `--file <path>`: A JSON file with the value, e.g. navigation.json
- `--type <type>`: The TypeScript type of the value, e.g. "Plan[]" (a type of the types/ folders, not the props of a component), imported from where it is found; the value is checked against it
- `--dry-run`: Show what would change without writing anything

## constant remove

```
reactsmith constant remove <name>
```

Remove a constant that nothing uses; the constants file goes with its last constant.

Arguments:

- `name`: The constant, e.g. "NAVIGATION"

Options:

- `--app`: It belongs to the app, not to a feature: e.g. parts of the layout, or data the whole app uses
- `--feature <name>`: The feature it belongs to
- `--component <folder>`: In the constants of one component, e.g. app/components/Sidebar
- `--dry-run`: Show what would change without writing anything

## style palette

```
reactsmith style palette
```

Set the colors of the app (tokens/colors.json, any hierarchy): only the given ones change; with no option, it writes the CSS and the type again from colors.json.

Options:

- `--set <path=value>`: Tokens to add or change in tokens/colors.json, separated by ";": a path in the hierarchy and a value, a token or a CSS expression, e.g. "text/default/secondary=#757575; background/brand={brand.800}"
- `--mode <mode>`: The mode the --set values are for, e.g. dark (default: every mode)
- `--remove <paths>`: Tokens or groups to remove, separated by ";": refused while a style or another token uses them
- `--primary <color>`: The main brand color, e.g. "#2563eb"
- `--primary-dark <color>`: The primary color in dark mode (default: the same)
- `--secondary <color>`: The second brand color
- `--secondary-dark <color>`: The secondary color in dark mode (default: the same)
- `--neutral <color>`: The gray the backgrounds, borders and text derive from, in light and dark mode
- `--success <color>`: The color of success states
- `--success-dark <color>`: The success color in dark mode
- `--warning <color>`: The color of warnings
- `--warning-dark <color>`: The warning color in dark mode
- `--danger <color>`: The color of errors and destructive actions
- `--danger-dark <color>`: The danger color in dark mode
- `--info <color>`: The color of information
- `--info-dark <color>`: The info color in dark mode
- `--force`: Move an old palette.css changed by hand anyway, losing those changes
- `--dry-run`: Show what would change without writing anything

## style typography

```
reactsmith style typography
```

Set the typography of the app (tokens/typography.json, any hierarchy): only the given ones change; with no option, it writes the CSS and the type again from typography.json.

Options:

- `--set <path=value>`: Tokens to add or change in tokens/typography.json, separated by ";": a path in the hierarchy and a value, a token or a CSS expression, e.g. "family/sans=Inter, sans-serif; size/heading/base=1.5rem; weight/heading={weight.semibold}"
- `--mode <mode>`: The mode the --set values are for, e.g. mobile (default: every mode)
- `--remove <paths>`: Tokens or groups to remove, separated by ";": refused while a style or another token uses them
- `--dry-run`: Show what would change without writing anything

## style spacing

```
reactsmith style spacing
```

Set the spacing of the app (tokens/spacing.json, any hierarchy): only the given ones change; with no option, it writes the CSS and the type again from spacing.json.

Options:

- `--set <path=value>`: Tokens to add or change in tokens/spacing.json, separated by ";": a path in the hierarchy and a value, a token or a CSS expression, e.g. "12=3rem; section={12}"
- `--mode <mode>`: The mode the --set values are for, e.g. mobile (default: every mode)
- `--remove <paths>`: Tokens or groups to remove, separated by ";": refused while a style or another token uses them
- `--dry-run`: Show what would change without writing anything

## style radius

```
reactsmith style radius
```

Set the radius of the app (tokens/radius.json, any hierarchy): only the given ones change; with no option, it writes the CSS and the type again from radius.json.

Options:

- `--set <path=value>`: Tokens to add or change in tokens/radius.json, separated by ";": a path in the hierarchy and a value, a token or a CSS expression, e.g. "default=0.5rem; card={lg}"
- `--mode <mode>`: The mode the --set values are for, e.g. mobile (default: every mode)
- `--remove <paths>`: Tokens or groups to remove, separated by ";": refused while a style or another token uses them
- `--dry-run`: Show what would change without writing anything

## style update

```
reactsmith style update <target>
```

Update an element's style: layout options, CSS, a style object, or Tailwind classes.

Arguments:

- `target`: The element: an id, or "path/to/File.tsx:line[:column]"

Options:

- `--name <style>`: The style of the element, e.g. "brand": its class (className={styles.brand}), its rule in the style file, and its id
- `--state <hover|focus-visible|focus-within|active|disabled|current|pressed|selected|expanded|placeholder|before|after>`: Apply the declarations to a state, e.g. hover, or a part of the element, e.g. placeholder (::placeholder)
- `--when <prop>`: Apply the declarations when a prop of the component is true (--when selected) or has a value (--when status=Error)
- `--at <breakpoint>`: Apply the declarations at a screen size, one of the "breakpoints" of reactsmith.config.json, e.g. --at mobile
- `--css <declarations>`: CSS declarations, e.g. "display: inline-flex; gap: 9px; &:hover { opacity: 0.8 }"
- `--css-file <path>`: A file with CSS declarations, e.g. a snippet from the design team
- `--object <object>`: A style object as in React's style prop, e.g. "{ display: 'inline-flex', gap: 9 }"
- `--object-file <path>`: A file with a style object
- `--class <classes>`: Tailwind classes that replace the style's classes, e.g. "inline-flex gap-2 hover:underline"
- `--direction <row|column|none>`: How it lays out its children: in a row or a column, or "none"
- `--gap <step>`: Space between its children, in steps of 0.25rem: 2 is 8px, or "none"
- `--align <start|center|end|stretch|none>`: Alignment of its children across the direction, or "none"
- `--justify <start|center|end|between|none>`: Distribution of its children along the direction, or "none"
- `--padding <steps>`: Space inside it: one step for all sides ("4"), or vertical and horizontal ("2 4"), or "none"
- `--dry-run`: Show what would change without writing anything

## style convert

```
reactsmith style convert
```

Convert the styles of a Tailwind project to CSS Modules: each Name.styles.ts becomes Name.module.css, with its imports, the config and the token files.

Options:

- `--to <css-modules>`: What to convert to: css-modules (required)
- `--dry-run`: Show what would change without writing anything

## messages

```
reactsmith messages
```

Set the translated texts of the app, one language at a time, in its message file (messages/<language>.json): keys grouped by the component that shows them. Elements show them with "element insert … --message <key>".

Options:

- `--set <key=text>`: Keys and their texts, separated by ";" (write "\;" for a ";" in a text), e.g. "TopBar.workshops=Workshops; TopBar.register=Register"
- `--locale <language>`: The language of the --set texts, e.g. "en": a new language gets its file
- `--remove <keys>`: Keys or groups to remove from every language, separated by ";": refused while an element shows them
- `--dry-run`: Show what would change without writing anything

## id

```
reactsmith id <target>
```

Print the id of the JSX element at a file location, which other commands take as their target.

Arguments:

- `target`: A location "path/to/File.tsx:line[:column]", or an id to check

## tree

```
reactsmith tree <file>
```

Describe the elements of a component, view or layout file: their ids, tags, texts, props and styles (with --json, as data to compare).

Arguments:

- `file`: The file: "app/components/TopBar/TopBar.tsx", from the source folder or the project root
