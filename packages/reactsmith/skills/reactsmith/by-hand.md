# Changing things by hand

Read this only when the caller asks you to write by hand something no command does (after an `unsupported` answer), before editing a file the commands manage. Some changes are safe by hand: `check` accepts them and the commands keep working around them. Others break the next command, so do them only as described here.

## Logic: always by hand

- **Handlers, state, hooks, derived values:** write them in the component body, above the `return`. Then pass them with commands: `element update <id> --props "onClick={toggle}"`, `--text "{count}"`.
- **Hooks used by several components** go in `hooks/` (the feature's, or `src/hooks/`), exported as `useX` from the folder's `index.ts`.
- **Helpers** go in `utils/`, **types** in `types.ts` or `types/`: never in a component file, which holds only the component and its props interface.
- **Types of data** (what a constant, an API or state holds) are written in `types/`: `export interface Product { … }`. A component's props type (`ProductCardProps`) is only for props, its own and other components' (`items: ProductCardProps[]`); `check` refuses it anywhere else (`props-type-outside-props`). Pass the data to the component through its props: `{...product}`.
- **Data loading:** `view create … --loader` creates the loader; write the fetching in it.

## Conditions

Conditions are written with commands (see the main skill). By hand goes only **the test**: a body variable for anything more than a name, which the condition then uses by name:

```tsx
const [open, setOpen] = useState(true);
const hasItems = items.length > 0;
const showBadge = soon && !disabled;
```

`check` refuses conditions outside their shape (`condition-shape-invalid`): a test that isn't a name (`{items.length > 0 && …}`), several elements in a branch, or a condition in a branch of another one. Move the logic into a variable, or the elements into one.

Conditional **text** is a value, not a condition: `const toggleLabel = open ? 'Hide' : 'Show'`, shown with `element update … --text "{toggleLabel}"`.

For a style that depends on a prop, don't write a condition: use `style update <id> --when selected --css "…"`.

## Styles

- **CSS the options can't express** (child selectors such as `.root[aria-current="page"] .label`, media queries, animations): write it in the component's style file (`Name.module.css`). `style update` changes only the properties it is given and leaves other rules alone.
- **Fonts and design tokens:** override them in `app/styles/global.css`, e.g. `--font-sans: 'DM Sans', system-ui, sans-serif;`. No command rewrites that file.
- **Colors:** use `style palette`; never edit `palette.css`, which the command writes. A hand change makes it refuse until `--force`, which loses the change.
- **Responsive styles:** media queries in the style file, by hand.
- **Tailwind:** `--when` works only with CSS Modules; with Tailwind, write the `data-[…]:` variants in the class list by hand.

## Props that hold elements

A prop typed `React.ReactNode` can't be rendered or given by a command. Prefer a component-typed prop (`icon: LucideIcon`, rendered with `element insert "{icon}"`), or `children` (`--interface "children: React.ReactNode"`), which commands fill.

## Icons from data

A constant holds only JSON, so it can't hold an icon. Keep the icon's name in the data, map names to icons in `src/utils/`, and look it up in the component:

```ts
// src/utils/icons.ts
import { ChartColumnIcon, LayoutDashboardIcon, type LucideIcon } from 'lucide-react';

const ICONS: Record<string, LucideIcon> = { dashboard: LayoutDashboardIcon, tables: ChartColumnIcon };

export const iconFor = (name: string): LucideIcon => ICONS[name] ?? LayoutDashboardIcon;
```

```tsx
const Icon = iconFor(icon);
```

Write `<Icon />` by hand, inside the element that holds it: `element insert "{icon}"` renders props only, not body variables.

## What no command does

Do these by hand, then run `check`:
- removing a view or a feature (its folder, its route in the routes file, and the links to it);
- renaming a view or a feature, or moving a view to another feature (its URL inside its feature moves with `view create … --index|--path`);
- deleting a layout: take it out of its routes first (the app router for an app layout; for a feature's layout, put its `children` back as the feature's routes array), then delete its folder;
- removing a declaration from a style: delete the line in the style file (`style update` adds and replaces declarations, it doesn't remove them).

## What check refuses

- **Anything but plain data in `constants.ts`** (imports, functions, components): put it in `utils/` or in a component.
- **Anything but the component and its props interface in a component file.**
- **A component's props type outside props** (`props-type-outside-props`): data, state or a variable typed `ProductCardProps` gets a type of its own in `types/`.
- **A `.map` that renders anything but one component with its props:** move the item's markup into a component and repeat it with `element insert <Component> --each`.
- **Table content in the wrong place,** such as a `span` directly in a `tr`: put it in a `td`.
- **A layout used anywhere but in routes** (`layout-import-outside-routes`): what a view or a component wants to reuse from a layout goes in a component, used in both.
- **Imports past a folder's `index.ts`** (`@/components/cards/Card/Card`): import from the folder or the type (`@/components/cards`).

## Formatting

Reformat freely. Ids come from the structure and the elements' names, not from lines.
