# Drafts: a whole component in one call

A draft is the JSX a component returns, written once, with `$` attributes for its styles. `component create` reads it, checks it with the same rules as the element commands, and writes the component, or writes nothing and says what to fix, line by line.

```
./node_modules/.bin/reactsmith component create <Name> --feature <f> [--interface "<props>"] --jsx - --json <<'EOF'
<draft>
EOF
./node_modules/.bin/reactsmith component create <Name> --replace --jsx - --json <<'EOF'
<draft>
EOF
```

- **Create** makes a new component (with `--feature`, `--app` or `--type`, and its props from `--interface`). Children first: a component the draft uses must already exist.
- **`--replace`** replaces what an existing component returns, and its styles. It finds the component by its name. Everything before the `return` stays: props, state, handlers, variables. Imports and props that only the old JSX used are dropped. To use a new prop, add it first with `component update <Name> --interface …`.
- **`--jsx draft.tsx`** reads the draft from a file instead of stdin.
- The result lists the component's ids, as `tree` prints them, for the next edits.

## What a draft is

One element, the root, and what it holds. There are no imports, no function, no `return`, no hooks and no props interface: the command writes those.

```tsx
<article $direction="column" $gap="3" $padding="4" $css="border-radius: var(--radius-lg)" $css-hover="border-color: var(--color-primary)">
  <img $name="photo" src={image} alt={title} />
  <h3 $name="title">{title}</h3>
  <div $name="footer" $direction="row" $justify="between" $align="center">
    <span $name="price" $css="font-weight: var(--font-weight-bold)">{price}</span>
    {onSale && <span $name="sale">On sale</span>}
  </div>
</article>
```

### Elements

- **HTML tags** in lowercase. **Components** in PascalCase: the project's, packages' (`NavLink`) and lucide icons (`SearchIcon`). `$from="shared"` (or a feature, `app`, a package) picks one when a name is in two places.
- **Imports** are added by the command.
- **What an element holds** is the same as for the commands. Layout elements (`div`, `section`, `ul`…) hold elements. Text elements (`span`, `p`…) hold text. Links, buttons, labels, headings and cells hold both. Components hold elements only when they declare `children`.

### Props

Attributes without `$` are props, with the same values as `--props`:
- literals: `href="/docs"`, `size={16}`, `disabled`
- names the component has: `{title}`, `{product.price}`, `onClick={toggle}`, `{...product}`
- in a translated app, its messages: `aria-label={t('menu')}`

A name must exist already: a prop, a constant, an import, or a variable written by hand before the `return`. So write the logic first, then the draft. Refused: `className` and `style` (use `$` attributes), functions (`onClick={() => …}`), calls, computed values (`{a + b}`), and JSX inside a prop.

### Children

- **Text:** `<h3>{title}</h3>`, `<p>Hello, {user.name}!</p>`. An element's text is one run. Elements may come before or after it (`<button><SearchIcon />Search</button>`), but not on both sides.
- **A message:** `<span>{t('register')}</span>`, alone in its element. Its text must be set first with `messages --set`.
- **A list:** `{links.map((link) => <NavLink key={link.href} {...link} />)}`, exactly this shape. Only a component repeats, with a key, and holds no children. One level of list per file.
- **A condition:** the test is a name, or `!name` with `&&`. Each branch is one element or one list, and conditions don't nest.
  - `{open && <nav />}`, `{!open && <nav />}`
  - `{open ? <A /> : <B />}`
  - `{label ?? <span>None</span>}`. `||` is refused: use `??`.
- **`{children}`:** in the root only, where its children go. Create needs `children: React.ReactNode` in `--interface`.
- **Comments** are dropped.

### Styles: `$` attributes

Each attribute is a `style update` on that element. Values are written as on the command line.

| Attribute | Does |
| --- | --- |
| `$name="price"` | names the element's style (its class and its id). Every styled element but the root needs one. |
| `$direction`, `$gap`, `$align`, `$justify`, `$padding` | layout options: `row\|column`, steps of 4px, `start\|center\|end\|stretch`, `start\|center\|end\|between`, `"2 4"` |
| `$css="…"` | declarations, as `--css` (nested `&:hover { … }` works too) |
| `$css-hover="…"` | a state: `hover`, `focus-visible`, `focus-within`, `active`, `disabled`, `current`, `placeholder`, `before`, `after` |
| `$css-at-mobile="…"` | at a breakpoint of `reactsmith.config.json` |
| `$css-when-selected="…"`, `$css-when-status-Error="…"` | when a prop is true, or has a value |
| `$class="…"` | Tailwind classes (Tailwind projects) |
| `$from="shared"` | where a component comes from |

The root's style is always `root`, so it takes no `$name`. Colors, fonts, spacing and radius are tokens (`var(--color-text-muted)`).

## When it refuses

Nothing is written. Each issue says `Line N:` of the draft, with a hint.
- **Problems with the draft itself** (`draft-…` codes) are all listed at once.
- **A step's refusal** (a name that doesn't exist, text in a `div`…) stops at the first one, the same as the element command would.
- **A type error or a `check` error** in the result comes last.

Fix the draft and run the same command again.

## What a draft doesn't do

- **Early returns:** a component with several returns can't be replaced. Turn them into a condition in the JSX by hand first, or edit it with the element commands.
- **Views and layouts** are not drafted: use the element commands for those.
- **Combining modifiers** ("on hover, on mobile") in one attribute isn't supported. Run `style update` afterwards.
- **Small edits** to a component that exists are faster with the element commands (`element insert`, `element update`, `style update`) than with a whole `--replace`.
