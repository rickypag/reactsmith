# What ReactSmith can't do yet

Read this before planning a feature, so the plan designs around these limits from the start instead of meeting them as refusals. Each one is either written by hand (see [by-hand.md](by-hand.md); `check` must pass after), or avoided by shaping the design.

## Logic and values

- **Logic is never a command:** state, effects, handlers, hooks, derived values, data loading. Write it by hand **before** the markup that uses it: a command refuses a name the component doesn't have yet.
- **Values** in `--props` and `--text` are names (`{label}`, `{user.name}`), their opposite (`{!open}`), literals, and in a translated app the component's messages (`{t('key')}`). Anything computed (`{items.length}`, `{a ? b : c}`, `{format(x)}`) goes in a variable first.
- **JSX as a value** (`icon={<SearchIcon />}`) and rendering a `React.ReactNode` prop: use a component-typed prop (`icon: LucideIcon`) or `children` instead.

## Markup

- **Text and elements:** layout elements (`div`, `section`, `form`, `details`…) hold elements only; text elements (`span`, `p`, `strong`…) hold text only. Links, buttons, labels, `summary`, headings and table cells hold both.
- **Prose with inline elements** (a `<code>` or a link inside a `p`'s sentence) can't be written: keep it to separate elements, or write it by hand.
- **Lists:** only a component repeats (`--each`), one level of list per file, and a list's items are changed through that component's props, not in place.
- **Conditions:** the test is a name or `!name`; each branch is one element or one list; conditions don't nest.

## Drafts

- **Only components** are drafted (`component create … --jsx`). Views and layouts are built with the element commands.
- **One return:** `--replace` refuses a component with early returns (`if (!data) return null`). Turn them into a condition in the JSX first.
- **One modifier per `$css-…` attribute:** "on hover, on mobile" is a `style update` afterwards.

## Styles

- `--css` takes declarations, the states (`:hover`, `:focus-visible`, `:focus-within`, `:active`, `:disabled`, current) and `::placeholder`, `::before`, `::after`. Not: other pseudo-elements, `@keyframes`, child selectors, media queries other than the config's breakpoints, removing a single declaration.
- With Tailwind, `--when` (a style by prop) isn't supported: CSS Modules is the recommended setup (`style convert --to css-modules`).

## Structure

- **Import rules:** features don't import each other or the app; shared code (`src/components`, `utils`, `types`…) doesn't import features or the app. Something two features use is a shared component (`component update X --type <type>`); something the app owns is passed down as props.
- **Not commands:** removing or renaming a view or a feature, moving a view to another feature, deleting a layout, moving a constant, moving an element to another file.

## Next.js

- Next routes the pages: `page.tsx`, `layout.tsx`, `loading.tsx` and route handlers in `src/app` are written by hand, and only render a view or a layout (`view create` suggests the page).
- `'use client'` is written by hand, as a component's first line.
- Components created in a module that isn't a component folder (next-intl's `Link` from `src/i18n/navigation.ts`) can't be inserted by command yet.
