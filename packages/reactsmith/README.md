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
| `next` | A Next.js app (`"framework": "next"`): Next routes the pages, so ReactSmith sets up and checks no router, no App files and no Vite alias. `src/app/` is Next's: check only makes sure it holds Next's files (pages, layouts, routes, metadata, CSS). ReactSmith's app folder becomes `src/shell/`. `view create` exports the view from its feature, and a `page.tsx` you write renders it. The code stays in `src/`. |
| `next-intl` | Translations (`"i18n"`): texts are messages in `messages/<language>.json`, set with `messages --set` and shown with `--message`. Set the library up first (routing, provider); `init` reads the default language from its routing. |
| `lucide-react` | Icons, inserted like components with the Icon suffix: `element insert SearchIcon`. |
| `tailwindcss` | Nothing by itself: `create-next-app` installs Tailwind by default, so `init` asks how to write styles, recommending CSS Modules (plain CSS, `Name.module.css`). Answer yes, or pass `--styles tailwind`, for Tailwind classes (`Name.styles.ts`). Without anyone to ask (`--json`, `--yes`), it uses CSS Modules and says so. A project already on Tailwind moves to CSS Modules with `style convert --to css-modules`. |
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
- **`src/app/`:** the App component moves here. Next to it, `init` creates the app router (`router.tsx`) with a not-found page, and the global styles: `styles/global.css` with the design tokens, and the design tokens in `styles/tokens/`: `colors.json`, `typography.json`, `spacing.json` and `radius.json`, from which their CSS variables (`colors.css`…) and the types of their names (`colors.ts`…) are written.
- **The `@/` import alias:** `@/components/cards` means `src/components/cards`, in `tsconfig.app.json` and in `vite.config.ts`.
- **`src/types/` and `src/utils/`:** what components need to be styled by their parent (`StyleableProps`, `cx`).
- **The skill for Claude Code** in `.claude/skills/reactsmith/`: it teaches Claude to make changes with the commands, and lists every command of the installed version. A short block in `CLAUDE.md` (created if missing) points Claude to it on every task. Commit both, so everyone working in the project gets them. `init` asks first; `--no-skills` leaves it out, and running `init` again later adds it. Later runs bring it up to date with the installed ReactSmith, keeping any file you changed.
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

`layout create` is a shortcut for the usual shell. After that, the layout and its parts are files like any other, and you change them with the same commands.

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

Move a part with `element move`, such as `element move "…/TopBar.tsx#search" --into "…/TopBar.tsx#actions" --position first`: it keeps its style and code as they are. Remove a part with `element remove`, such as `element remove "app/layouts/RootLayout/RootLayout.tsx#root/Sidebar"`. Its files stay, so you can use it again; delete them with `component remove Sidebar` once nothing uses it (`check` warns about unused components and styles). The styles of removed elements go when nothing else uses them. `element remove … --keep-children` undoes a wrap: it removes only the element, leaving what it held in its place.

**A layout for some pages only**

Layouts nest: the root layout holds what every page has, and a feature can have a layout of its own around its pages. For a site whose home page has only the top bar, and whose docs pages also have a sidebar:

```sh
npx reactsmith layout create --topbar
npx reactsmith feature create docs --path docs
npx reactsmith layout create --feature docs --sidebar
```

The last one creates `features/docs/layouts/DocsLayout/` with the docs' own `Sidebar`, renders the docs pages inside it, and adds a not-found page for the docs, so unknown URLs under `/docs` keep the sidebar. The views you create in the feature after that go inside it. `check` warns when a layout repeats a part of a layout around it, such as a top bar in both.

A part that already exists elsewhere moves first, with every import: `component update Sidebar --feature docs` moves the sidebar into the docs feature, and the components only it uses come with it. Several features can share one layout from the app: `layout create GuideLayout`, then `feature create guides --layout GuideLayout`.

To change where a page is, run `view create` again on it: `view create Introduction --feature docs --index` moves it to `/docs`, and a warning lists the links to its old URL.

### Many commands at once

`batch` runs a list of commands in one go, much faster than one by one: one per line, from a file or from stdin.

```sh
# topbar.txt
T=app/components/TopBar/TopBar.tsx
element insert nav --into "$T#root" --name links --gap 4
element insert a --into "$T#links" --props "href='/docs'" --text Docs
style update "$T#links" --at mobile --css "display: none"
```

```sh
npx reactsmith batch topbar.txt
```

Every line is checked before anything runs, so a typo runs nothing. The lines then run in order, each on the code the lines before left, and the first refusal stops the batch: the lines before it stay done, and the output says which ones didn't run. A `NAME=value` line sets a variable for the lines after it, and `#` starts a comment.

## Building from Figma

ReactSmith can build the UI from a Figma file, through Claude Code. Link the file in `reactsmith.config.json`:

```json
"design": { "figma": "https://www.figma.com/design/<key>/<name>" }
```

Then ask Claude to build what you need, such as "build the docs site from Figma" or "implement the Pricing page". The `reactsmith-from-figma` skill, added by `init`, works from exports of the design saved in `.reactsmith/figma/` and writes `reactsmith-plan.md`: the commands it will run, the decisions it took, and what it can't build. Review the plan, then let Claude run it. When the design changes, a new export is compared with the one before, and only what changed in the design is applied.

There are three ways to get the exports. Figma limits API reads on its free and View or Collab seats, so the skill tries them in this order and never retries a refused read:
- **The ReactSmith export plugin** (`packages/figma-export`): select the screens in Figma, run the plugin, and save its file. It needs no API calls, so no limits apply.
- **`fetch.mjs`,** with your Figma token (`FIGMA_TOKEN=… node .claude/skills/reactsmith-from-figma/fetch.mjs <link>…`): all the screens in one read, plus one for their components.
- **The Figma MCP server,** if you prefer it. Its reads count against the same limits.

The file has to follow a few conventions, so that its components, props and layout map to commands without guessing: slash names for where components live (`buttons/PrimaryButton`, `app/TopBar`, `docs/PriceTable`), auto layout everywhere, component properties for props, and color variables, whose names become the palette's hierarchy. They are in [figma-conventions.md](skills/reactsmith-from-figma/figma-conventions.md).

## Changing things by hand

The commands don't cover everything, and they don't need to: the code is yours. These changes are safe. `check` accepts them, and the commands keep working on the files around them.

**Styles**
- **Translated texts** are messages, one file per language, keys grouped by the component that shows them: `messages --set "TopBar.register=Iscriviti" --locale it` sets a text, `element insert button --into … --message register` shows it as `{t('register')}` (the component gets `const t = useTranslations('TopBar')` the first time), and `element update <id> --message …` turns a text into a message. `check` reports keys missing from the default language (error), texts still to translate in the others, texts shown nowhere, and literal texts in components (warnings).
- **Styles for other screen sizes** don't need hand-written media queries: `style update <element> --at mobile --css "display: none"` applies at the `mobile` breakpoint. The breakpoints live in `reactsmith.config.json`, as many as you need, in cascade order (a later one wins where both apply): `"breakpoints": { "tablet": "(max-width: 1023px)", "mobile": "(max-width: 767px)" }`. The size tokens use the same ones (`style typography --set "…" --mode tablet`), and `check` warns about a media query on the screen size that isn't a breakpoint.
- **Styles that depend on a prop** don't need hand-written CSS: `style update <element> --when selected --css "…"` styles an element of a component when its prop `selected` is true, or `--when status=error` when it has that value.
- **Extra CSS:** write it in the component's style file (`Sidebar.module.css`). This covers child selectors (`.root[aria-current="page"] .label`), attribute selectors (`.root[data-status="error"]`) and media queries. `style update` changes only the properties it is given, and leaves your rules alone.
- **Fonts:** set the family with `style typography --set "family/sans='DM Sans', system-ui, sans-serif"`, and load the font yourself (a link or `@font-face`). Other overrides go in `app/styles/global.css`, which no command rewrites.
- **The colors:** `tokens/colors.json` is the palette, a hierarchy of any shape, which you can edit by hand or with `style palette` (`--set`, `--mode`, `--remove`, `--primary`…). `colors.css` and `colors.ts` are written from it: run `style palette` with no option after editing the JSON. A project with the old `palette.css` moves to it the first time `style palette` runs.
- **The typography:** `tokens/typography.json` works the same way with `style typography`: families, sizes, weights, line heights and letter spacing, each a hierarchy, with desktop and mobile values. The fonts of an older `global.css` move there the first time it runs.
- **Spacing and radius:** `tokens/spacing.json` (`style spacing`, `var(--space-2)`) and `tokens/radius.json` (`style radius`, `var(--radius)`, `var(--radius-lg)`), the same way. The layout options write the spacing steps (`--gap 2` is `var(--space-2)`), so keep the default steps 1, 2, 3, 4, 6 and 8.

**Code in components**
- **Conditions** are written with commands: `element insert Badge --into … --if soon` writes `{soon && <Badge />}`, `element insert "{?open}" --around <element>` puts an existing element in one, and `--fallback label` writes `{label ?? <Placeholder />}`. By hand goes only a test that isn't a name: put it in a variable first (`const hasItems = items.length > 0`), then test the variable. `check` refuses conditions with other tests, several elements in a branch, or nested conditions.
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
