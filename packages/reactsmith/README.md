# ReactSmith

A CLI that gives React projects a feature-based structure and builds them with commands: features, views, layouts, components, elements, styles and constants. `reactsmith check` validates the structure.

```sh
npx reactsmith help
npx reactsmith help <command>
```

## How to use it

### 1. Set up your project

**What you need**
- **Node.js 22.13** or later.
- **A React project with TypeScript and Vite**, such as the one `npm create vite@latest my-app -- --template react-ts` makes. A new project and an existing one both work.
- **A clean git state.** `init` moves and rewrites a few files, so commit first: you can see exactly what it changed, and undo it.

**Install ReactSmith**

ReactSmith isn't published on npm yet. Until it is, build it from its repository, pack it, and install the package file in your project:

```sh
# in the ReactSmith repository
npm install
npm run build -w reactsmith
npm pack -w reactsmith        # writes reactsmith-0.1.0.tgz

# in your project
npm install -D <path-to>/reactsmith-0.1.0.tgz
```

**Install what you'll build with, before init**

`init` looks at your `package.json` and sets ReactSmith up for what it finds:

| Package | What ReactSmith does with it |
|---|---|
| `react-router` (7) | Pages: features and views get routes, links use `NavLink`. Without it, there is no routing. |
| `lucide-react` | Icons, inserted like components with the Icon suffix: `element insert SearchIcon`. |
| `tailwindcss` | Styles as Tailwind classes, instead of CSS Modules (the default). |
| `@mui/material` | MUI's `Box`, `Stack`, `Grid` and `Container` count as layout elements. |

For a site with pages and icons:

```sh
npm install react-router lucide-react
```

If you add one of them later, run `init` again. It is safe to run several times: it keeps what is already set up.

**Run init**

```sh
npx reactsmith init
```

It asks one question: whether to move `App.tsx` from `src/` into `src/app/` (recommended). Pass `--yes` to take the defaults without questions, as in a script or with an AI agent. `--dry-run` shows the changes without making them.

What it does:
- **`reactsmith.config.json`:** where things go, plus what it found (router, icons, styles) and the types of shared components (buttons, cards, tables…). The file is yours to change.
- **`src/app/`:** the App component moves here. Next to it, `init` creates the app router (`router.tsx`) with a not-found page, and the global styles: `styles/global.css` with the design tokens, and `styles/palette.css` with the colors.
- **The `@/` import alias:** `@/components/cards` means `src/components/cards`, in `tsconfig.app.json` and in `vite.config.ts`.
- **`src/types/` and `src/utils/`:** what components need to be styled by their parent (`StyleableProps`, `cx`).
- **The Vite starter page:** `init` replaces it with an App that renders the router, and deletes the starter's CSS and images. An App of your own isn't replaced. `init` lists what to add to it instead: rendering the router, and importing the global styles.

It ends with `reactsmith check`:

```
✔ Project is set up and valid.
```

`npm run dev` now shows an empty page at `/`, because the app has no pages yet; any other path shows the not-found page. The next steps add the pages.

### 2. Add a layout: a sidebar, a top bar

The layout is what every page renders in. To start with a sidebar:

```sh
npx reactsmith layout create --sidebar
```

Add `--topbar` for a top bar across the full width, above the sidebar and the page. It creates:
- **`app/layouts/RootLayout/`:** the root layout, with the page rendered in its `main`. `router.tsx` now renders every page inside it.
- **`app/components/Sidebar/`:** the sidebar, an app component that starts empty (and `TopBar/` with `--topbar`).

`layout create` is a shortcut for the usual shell, and it runs once. After that, the layout and its parts are files like any other, and you change them with the same commands.

**Fill the sidebar**

Elements are addressed by ids: the file, from `src/`, then `#` and the element's name. `--name` gives an element its name, which is also its style in the file's style file. A component's outer element is `root`.

```sh
npx reactsmith element insert span --into "app/components/Sidebar/Sidebar.tsx#root" --text "My App" --name brand
npx reactsmith element insert nav --into "app/components/Sidebar/Sidebar.tsx#root" --name links --gap 1
npx reactsmith element insert NavLink --into "app/components/Sidebar/Sidebar.tsx#links" --text "Home" --props "to='/'" --name link
npx reactsmith style update "app/components/Sidebar/Sidebar.tsx#link" --css "padding: 6px 10px; color: var(--color-text-muted); text-decoration: none"
npx reactsmith style update "app/components/Sidebar/Sidebar.tsx#link" --state current --css "color: var(--color-primary)"
```

`NavLink` is React Router's link: it changes the page without reloading it, and `--state current` styles the link of the open page.

**Change the layout later**

Add a part by creating it and inserting it. For a top bar across the full width, wrap the sidebar and the page in a row (`--around … --through …` puts the new element around them), turn the root into a column, and put the top bar first:

```sh
npx reactsmith component create TopBar --app --root header --direction row --align center --justify between
npx reactsmith element insert div --around "app/layouts/RootLayout/RootLayout.tsx#root/Sidebar" --through "app/layouts/RootLayout/RootLayout.tsx#main" --name body --direction row --gap 0
npx reactsmith style update "app/layouts/RootLayout/RootLayout.tsx#body" --css "flex: 1; min-height: 0"
npx reactsmith style update "app/layouts/RootLayout/RootLayout.tsx#root" --direction column
npx reactsmith element insert TopBar --into "app/layouts/RootLayout/RootLayout.tsx#root" --position first
```

For a top bar next to the sidebar, above the page only, insert it at the start of `main` instead: `element insert TopBar --into "…/RootLayout.tsx#main" --position first`.

Remove a part with `element remove`, such as `element remove "app/layouts/RootLayout/RootLayout.tsx#root/Sidebar"`. Its files stay, so you can use it again; delete them with `component remove Sidebar` once nothing uses it (`check` warns about unused components and styles). The styles of removed elements go when nothing else uses them. `element remove … --keep-children` undoes a wrap: it removes only the element, leaving what it held in its place.

## Changing things by hand

The commands don't cover everything, and they don't need to: the code is yours. These changes are safe. `check` accepts them, and the commands keep working on the files around them.

**Styles**
- **Styles that depend on a prop** don't need hand-written CSS: `style update <element> --when selected --css "…"` styles an element of a component when its prop `selected` is true, or `--when status=error` when it has that value.
- **Extra CSS:** write it in the component's style file (`Sidebar.module.css`). This covers child selectors (`.root[aria-current="page"] .label`), attribute selectors (`.root[data-status="error"]`) and media queries. `style update` changes only the properties it is given, and leaves your rules alone.
- **Tokens and fonts:** override them in `app/styles/global.css`, for example `--font-sans: 'DM Sans', system-ui, sans-serif;` or `--color-text: #2b3674;`. No command rewrites that file.
- **The palette file:** `palette.css` is written by `style palette` alone. If it was changed by hand, the command refuses rather than lose the change. Move the change to `global.css`, then pass `--force`.

**Code in components**
- **Conditions:** `{open && <MenuIcon />}` and `{done ? <CheckIcon /> : null}` are fine. Commands can't target the elements inside a condition, though, and `element update --text` refuses an element that holds one.
- **Text elements** (`span`, `p`, `h1`…) hold only text and the values `--text` writes, such as `{label}`. An icon or another element goes next to the text element, in its container. Links, buttons and table cells hold both.
- **Icons from data:** a constant holds only JSON, so it can't hold an icon. Keep the icon's name in the data instead, map names to icons in `src/utils/`, and look the icon up in the component:

  ```ts
  // src/utils/icons.ts
  import { ChartColumnIcon, LayoutDashboardIcon, type LucideIcon } from 'lucide-react';

  const ICONS: Record<string, LucideIcon> = { dashboard: LayoutDashboardIcon, tables: ChartColumnIcon };

  export const iconFor = (name: string): LucideIcon => ICONS[name] ?? LayoutDashboardIcon;
  ```

  ```tsx
  export const NavItem: React.FC<NavItemProps> = ({ to, label, icon }) => {
    const Icon = iconFor(icon);
    return <NavLink className={styles.root} to={to}><Icon /><span className={styles.label}>{label}</span></NavLink>;
  };
  ```

- **Formatting:** reformat freely. Ids come from the code's structure and the elements' names, not from lines.

**What `check` refuses, and where it goes instead**
- **Anything but plain data in `constants.ts`** (imports, functions, components): put it in `utils/` or in a component.
- **Anything but the component and its props interface in a component file:** data goes in `constants.ts`, helpers in `utils/`, types in `types.ts`.
- **A `.map` that renders anything but one component with its props:** move the item's markup into a component and repeat that, with `element insert <Component> --each`.
- **Table content in the wrong place,** such as a `span` directly in a `tr`: put it in a `td`.
