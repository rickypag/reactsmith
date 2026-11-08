# Building guide (parked)

Not installed into projects. This is the design guidance the `reactsmith` skill held before it became a translator: how to decide what to build. In v1 the caller makes these decisions. This page is kept for a later, higher layer (an agent that builds from a design or a description) that writes precise requests for the translator. See [README.md](README.md).

## Where things go

- **A page** is a view in a feature: `feature create docs --path /docs`, then `view create Introduction --feature docs --path introduction`. `--index` makes it the feature's page at its base path (`/docs`), and `--path '*'` the page for the URLs under the feature that nothing else matches.
- **The shell** is layouts, nested, each holding only its own part (see [Layouts](#layouts)).
- **A part used across the app** (a top bar's menu, a footer) is an app component: `component create NavMenu --app`.
- **A basic, reusable component** (a button, a card, a badge) is shared, by type: `component create PrimaryButton --type buttons`. Before creating one, look in `src/components/<type>/` for one that already exists. The types are in `componentTypes` in reactsmith.config.json.
- **A component of one domain** (a pricing table of the billing pages) belongs to its feature: `component create PriceTable --feature billing`.
- **Data** (navigation links, cards of a grid) is a constant, as JSON: `constant create NAV_LINKS --app --value '[…]'`, then rendered as a list. Give it a type of its own, written in a `types/` folder (`export interface Plan { …; variant: 'brand' | 'neutral' }`), then `--type "Plan[]"`, when a value must be one of a union (`"variant": "brand"`): an untyped string doesn't fit. Never the props type of a component (`PricingCardProps`): data typed as props breaks whenever the component's props change, so `check` refuses it.

Component names are unique in the project.

## Layouts

A layout is the frame around pages: its parts, and `<Outlet />` where the page goes. Layouts nest, so each one holds only what the layouts around it don't: a page under `/docs` renders inside RootLayout (the top bar), then DocsLayout (the sidebar). `check` warns when a layout repeats a part of a layout around it (`layout-repeats-parent`), because the page would show it twice.

- **The root layout,** around every page: `layout create --topbar` (and `--sidebar` when every page has one). Its parts are app components.
- **A feature's layout,** around that feature's pages only: `layout create --feature docs --sidebar`. It lives in `features/docs/layouts/DocsLayout`, wraps the feature's routes, and its parts are components of the feature. It comes with a not-found page of the feature, so unknown URLs under `/docs` keep the sidebar. New views of the feature go inside it.
- **A layout several features share:** `layout create GuideLayout` in the app, then `feature create guides --layout GuideLayout` for each feature. They share one route, so the layout stays mounted while moving between them.

What `layout create` writes is ready to use: `#root` (a row when it has a sidebar) holds the parts and the page area, `#main` in the root layout (a `<main>` that scrolls) and `#content` in a nested one (a `div` that fills the space under the outer layouts and scrolls on its own, so the sidebar stays in place). A part that already exists elsewhere (an app `Sidebar` that only the docs use) moves first: `component update Sidebar --feature docs`.

## Building a piece of UI

Work from the outside in:

1. **Decide the components.** Split the design into components: what repeats becomes a component repeated over a list, what is reused becomes a shared component. A design without components (flat layers) still has them: a group that repeats (a title above a row of cards) is a component, as each repeated card is.
2. **Create them**, with their props and their outer element:
   `component create NavItem --app --interface "label: string; to: string; icon: LucideIcon" --root NavLink --root-props "to={to}"`.
   `--interface "children: React.ReactNode"` makes a wrapper that holds elements where it is used. A component that only shows text (a badge, a label) takes a string prop instead: `--interface "label: string" --root span --text "{label}"`.
   Types in `--interface` are imported from where they are found, like components: another component's props (`items: SidebarLinkProps[]`), the `types/` folders, or a package (`icon: LucideIcon`). A type found nowhere, or in two places, becomes a placeholder in `types.ts`, with a warning.
3. **Insert the elements**, each with `--name`, so their ids stay the same when other elements come and go: `element insert span --into "…/NavItem.tsx#root" --text "{label}" --name label`.
4. **Add data and lists:** a constant, passed as a prop if needed, then `element insert NavItem --into "…#links" --each NAV_LINKS --as link --key link.to --props "{...link}"`. Only components repeat.
   **One level of list per file.** A repeated group with repeated content of its own (rows of cards, menu groups with links) is one component that owns the inner list: `ResultRow` takes `title: string; items: BookCardProps[]` and repeats `BookCard` over `items` in its own file; the view repeats `ResultRow` over `ROWS` with `--props "title={row.title} items={row.items}"`. Groups that look alike get one component, with the same item component in each (one card for every row), unless they really differ.
5. **Style:** `style update <id> --css "…"`. Set up the tokens first when the design has them: `style palette`, `style typography`, `style spacing`, `style radius`.
