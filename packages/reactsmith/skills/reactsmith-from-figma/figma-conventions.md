# Figma conventions for ReactSmith

A Figma file built this way maps to ReactSmith commands without guesswork: the designer has already decided the components, their props and their layout, and the agent translates. Whatever breaks a convention is reported in the plan, not guessed.

## Components: the name says where they live

A component's name is a path, written with slashes (Figma groups them in the assets panel):

| Figma name | Lives in | Command |
|---|---|---|
| `buttons/PrimaryButton` | shared, type `buttons` | `component create PrimaryButton --type buttons` |
| `app/TopBar` | the app | `component create TopBar --app` |
| `docs/PriceTable` | the feature `docs` | `component create PriceTable --feature docs` |

- The first part is a type of shared components (the `componentTypes` of `reactsmith.config.json`: `buttons`, `cards`, `badges`…), `app`, or a feature.
- The last part is the component's name, in PascalCase, unique in the file, as in the code.
- A component set (variants) is one component; its variants become a prop (see below).

## Pages and the shell

- **The shell** is what frames the page: instances of components around a frame named `main`, where the page goes. In code it is a chain of layouts, each holding its own part (see the `reactsmith` skill, "Layouts"):
  - **the root layout** holds the parts every screen has (a top bar): its components are `app/…`;
  - **a feature's layout** holds the parts only that feature's screens have (the docs' sidebar): `layout create --feature docs`, and its components belong to the feature, `docs/Sidebar`.
- **Which part is whose** comes from the screens: a part on every screen (of the export and of the project) is the root layout's; a part on all the screens of one feature, and on no other screen, is that feature's layout. Frames that only arrange the shell (a `body` holding the sidebar and `main`) belong to the layout that holds them.
- **Layout frames,** optional, say it outright: a frame named `RootLayout` (with `main` empty) is the root layout; a frame named `<Feature>Layout` on the feature's page (`DocsLayout` on `docs`) is the feature's layout, drawn with the root layout's parts around it or without them. They are layouts, not views. Without them, the screens decide.
- **One Figma page per feature,** named like the feature (`docs`).
- **One top-level frame per view,** named like the view (`Introduction`, `Quick start`). Frames have no description in Figma, so the routes come from the names: the view's path is its name in kebab-case (`introduction`, `quick-start`), and the feature's base path is the page's name (`/docs`). A different path, or a feature's index page, is said in the request (or the plan asks): it is not in the file.
- **A view frame is the page, with or without its shell:**
  - **a full screen,** as designers draw pages: the shell's instances arranged as in the layouts, and the page's content **inside the frame named `main`**. Only what is inside `main` is the view; the shell is the layouts', and is never built into the view.
  - **content only:** the whole frame is the view.
- **Reported, never guessed:**
  - in a full screen, layers outside `main` that are not instances of shell components (content next to `main` belongs inside it);
  - screens of one feature with different shells (one with a sidebar, one without): a feature has one layout;
  - a part on the screens of several features but not all: a layout those features share is a decision (`layout create <Name>` and `feature create … --layout`), put it under "Decisions";
  - a shell component named for another owner than its layout (`app/Sidebar` only on docs screens): build it as the layout's owner's (`docs`), and suggest renaming it in Figma.
- Frames on other pages (a `Preview` page, a copy of a screen for review) are not views, and are not built.
- **A layer hidden by hand** (hidden, with no boolean property behind it) is set aside for now, not part of the design: it is not built, and the plan lists it under "Hidden in Figma, not built", so the user can confirm. In an update, a built element whose layer is now hidden is removed (and one shown again is inserted). A layer hidden by a boolean property is a condition (see "Props").

## Layout

- **Every frame that holds other layers uses auto layout.** Absolute positioning and groups are reported, not translated.
- Direction, gap, padding and alignment map to the layout options:

  | Auto layout | Option |
  |---|---|
  | Horizontal / vertical | `--direction row` / `column` |
  | Gap | `--gap <px ÷ 4>` (a step is 0.25rem = 4px) |
  | Padding | `--padding <vertical ÷ 4> <horizontal ÷ 4>` |
  | Alignment across the direction | `--align start/center/end/stretch` |
  | Alignment along it, "space between" | `--justify start/center/end/between` |

  Values that aren't multiples of 4px go in `--css` (`gap: 10px`).
- **Spacing and radius variables are tokens,** in `app/styles/tokens/spacing.json` and `radius.json`, by their names like colors: `Space/400` is `space.400`, `var(--space-400)`; `Radius/200` is `var(--radius-200)`. A gap or padding bound to a variable uses it in `--css` (`gap: var(--space-400)`) instead of `--gap`.
- **Sizing:** "fill container" is `flex: 1` (or `align-self: stretch` across), "hug" needs nothing, a fixed width or height is `width: 240px`, all with `--css`.

## Layer names

- **A layer that needs its own style** gets a camelCase name: `brand`, `searchButton`, `links`. It becomes the element's `--name`, its style and its id. Layers with default names (`Frame 12`, `Text`) get no style of their own.
- **The HTML tag** goes before the name when it isn't a plain `div`, separated by a colon: `nav: links`, `header: root`, `a: githubLink`, `button: toggle`, `ul: items`.
- **A component's outer frame** is its root. Its tag goes in the component's description, as `root: button` (`component create … --root button`); without it, the root is a `div`.
- **Links:** with a router, `root: a` (or an `a:` layer) is a link inside the app: it becomes the router's `NavLink`, with a `to: string` prop. A true/false variant named `active` or `current` on it is the current page: `style update … --state current`, not a prop. Figma has no URLs, so the plan proposes the `to` values under decisions.

## Text

- **Text layers** become text elements: `span` by default, or the tag before the name (`h1: title`, `p: lead`).
- **Typography variables are tokens,** like colors, in `app/styles/tokens/typography.json`, one group per property: `family` (`--font-*`), `size` (`--text-*`), `weight` (`--font-weight-*`), `line-height` (`--leading-*`), `letter-spacing` (`--tracking-*`). A variable goes in the group of what it holds, with its name as the path: `Heading/Size Base`, a size, is `size.heading.size-base`, `var(--text-heading-size-base)`. A variable that is another variable is a reference (`{size.scale.06}`). Sizes are written in rem (px ÷ 16).
- **Its modes are screen sizes,** desktop and mobile by default (`--mode mobile`, in a media query). Figma's modes (Desktop, Tablet, Mobile) are matched to them in the plan.
- **Text styles** (`Heading/H1`, `Body/Regular`) become their properties in `--css`: the variables they are bound to (`font-size: var(--text-heading-size-base)`), or their raw values when they have none, listed in the plan as candidate tokens. Font files are loaded by the developer.

## Props: component properties

| Figma property | Prop | How it is used |
|---|---|---|
| Text | `label: string` | the text layer shows it: `--text "{label}"` |
| Variant with the values `true` and `false` (`active = true, false`) | `active?: boolean` | `style update … --when active` for what the `true` variant changes |
| Boolean property that shows or hides a layer | `soon?: boolean` | a condition: `element insert … --if soon`, or `element insert "{?soon}" --around <element>` |
| Variant (`size = sm, lg`) | `size: 'sm' \| 'lg'` | `style update … --when size=sm` |
| Instance swap of an icon | `icon: LucideIcon` | `element insert "{icon}"` |
| Slot property (or a frame meant to hold other instances) | `children?: React.ReactNode` | elements are inserted into the usage |

Name the properties as the props should be named, in camelCase.

- **True/false variants are booleans.** A boolean property can only show or hide layers, so a state that changes styles (active, selected, expanded) is a variant with the values `true` and `false`. Its default variant is the prop's default: the styles of the default go in the base rules, the other variant's differences under `--when`.
- **A variant that hides a layer** (e.g. `expanded=false` hides the slot) is a condition, like a boolean property (`--if expanded`); the styles it changes (a rotated chevron) still go under `--when`. When the state changes inside the component (a group that collapses itself), the test is a `useState` written by hand, and the condition tests it by name.

## Slots and data

A slot is filled where the component is used. When **every use** fills a slot with instances of **one component**, differing only in their properties (a group's links), the content is data, not markup:

- the component gets a list prop instead of `children`, named after the slot (`nav: items` → `items: …[]`), typed with the item component's props;
- the slot's frame keeps its tag and name, and holds the item component repeated over the list (`element insert SidebarLink --each items --as item --key item.label --props "{...item}"`);
- the values set on the instances become a constant, nested as in the file (groups, each with its items).

A slot filled with different components, or with layers that aren't instances, stays `children`.

## Icons

- Icons are instances of a lucide icon component, named like on lucide.dev: `search`, `chevron-down`. They become `SearchIcon`, `ChevronDownIcon`.
- **A picture drawn in Figma** (a logo, an illustration: a layer made only of shapes, not an icon instance) comes in the export with its `svg`. Save it as `public/<layer name in kebab-case>.svg` and insert it as an image: `element insert img --into … --props "src='/figma.svg' alt='Figma' width={40} height={39}"`, its size from the layer. lucide has no brand logos (GitHub, X, Discord…), so logos are built this way. Its colors are fixed in the file: it doesn't follow dark mode.
- A drawn layer named like a lucide icon (a frame `chevron` holding a path) may be built as that icon instead; say so under decisions.

## Colors

- **A color variable is a token of the palette, by its name:** `Text/Default/Secondary` is `text.default.secondary` in `app/styles/tokens/colors.json`, the CSS variable `var(--color-text-default-secondary)`. "default" keys at the end add nothing: `Background/Brand/Default` is `var(--color-background-brand)`.
- **Any names work.** The palette takes the file's hierarchy as it is. Variables the palette doesn't have yet are added with `style palette --set "text/default/secondary=#…"`, one value per mode (`--mode dark`); a variable whose value is another variable is written as a reference, `--set "background/brand/default={brand.800}"`, so the palette keeps the chain.
- **Modes** are the palette's `$modes`, light and dark by default. Figma's mode names ("SDS Light") are matched to them in the plan.
- Fills and strokes that use a variable become `var(--color-<path>)` in `--css`, with the design's variable. A raw color (no variable) is written as is, and listed in the plan as a candidate variable.
- **Projects started from the default palette** have the roles `primary`, `secondary`, `neutral`, `success`, `warning`, `danger`, `info`, with `bg`, `surface`, `border`, `text`, `text-muted`, `primary-hover`, `primary-subtle` and `on-primary` derived from them. A file whose variables are named after them sets them with `style palette --primary "#…"`.
- Variable names come from the Figma MCP (the variables of a selection). The file's REST API returns them only on Enterprise plans.

## Data

**Repeated instances of one component** with different property values (sidebar links, cards in a grid) are data: a constant holding the values, and one list (`element insert … --each`). Keep them in one auto-layout frame of their own, with nothing else in it.

## Not supported yet

Reported in the plan, for the developer to do by hand: prototyping and interactions, responsive variants of a frame, images other than logos and icons, effects beyond a simple shadow, and absolute positioning.
