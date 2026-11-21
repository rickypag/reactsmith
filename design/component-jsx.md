# A component from its JSX: the draft grammar

Status: decided with the user on 2026-11-17. Create and replace are built: `src/shared/components/draft/parse.ts` (the grammar), `src/shared/components/draft/replace.ts` (the replace's start and cleanup) and `src/commands/component/create/draft.ts` (the run).

## Why

After the trials, building a component element by element was too slow: one command and one agent turn per element, about 16s per turn. With `component create --jsx`, the agent writes a whole component's JSX in one call. ReactSmith checks it before writing anything. Either everything is written, or nothing is and each issue points to its line in the draft.

The element commands stay for small edits.

## The command

```
reactsmith component create <Name> (--feature <f> | --app | --type <t>) [--interface "<members>"] --jsx <file|->
reactsmith component create <Name> [--from <source>] --replace --jsx <file|->
```

- `--jsx -` reads the draft from stdin, so a heredoc makes a whole component one tool call. `--jsx <file>` reads it from a file.
- **Create:** the component is created as `component create` does today (folder, index.ts, style file), with its props from `--interface`. The draft becomes what it returns.
- **`--replace`:** the component exists. Only what's inside its `return` is replaced, together with the styles of the old elements. Everything before the `return` stays: props, hand-written logic, variables. To add a prop and use it, first run `component update <Name> --interface …`, then `--replace`. With `--replace`, `--interface` is refused.
  - The component is found by its name, since names are unique. `--feature`, `--app` or `--type` can say where it must be. Views and layouts are refused.
  - It must have one `return`, or an arrow body, of JSX. A component with early returns is refused (`replace-return-ambiguous`).
  - The style file is rewritten with only the root's style (its layout, or the default of its kind, as create writes it), then each `$` attribute adds its own.
  - A styleable component's root keeps `className={cx(styles.root, className)}`.
  - At the end, an import or destructured prop that only the old JSX read is removed. Code written by hand stays, even if nothing uses it any more.
  - The final checks count only what the replace adds: `check` is compared with a run before it, and the type check looks only at the returned JSX.
- **`{children}`:** the root may render `{children}`, in its place among the root's elements. Create needs `children` in `--interface`.
- With `--jsx`, these flags are refused: `--root`, `--root-props`, `--text` and the layout flags. The draft's root element takes their place.
- One component per call. Children first: a component used in the draft must already exist.

## How it runs

The draft is turned into the steps that already exist, called through their planners in one process:

| In the draft | Becomes |
| --- | --- |
| the root element | the component's root (`--root`, `--root-props`) |
| an element or component | `element insert <tag> --into <its parent>` with `--props`, `--text`/`--message`, `--from` |
| `.map(...)` | `--each`, `--as`, `--key` |
| `&&`, `!…&&`, `?:`, `??`, `\|\|` | `--if`, `--fallback`, the other branch through `{?test}` |
| `$` attributes | `--name` on the insert, then `style update` |

1. **Parse.** Every grammar error is reported at once, with its line. Nothing runs.
2. **Steps.** They run in the order of the draft, each on the result of the ones before. The planners find their targets by reading the disk, so each step is written right away. A journal (`FileJournal` in `changes.ts`) keeps every file as it was before the run. The first refusal stops the run, every file is put back, and the refusal is reported on the draft line it came from, with the step's hint.
3. **Check.** The steps' TypeScript checks are put off (`deferTypeChecks`) and run once, on the new file. Then `check` runs, and its issues inside the new component's folder count, except `component-unused`, since a child is unused until its parent exists. Any error means every file is put back.
4. **Result.** The output lists the changed files, as other commands do, plus the new component's ids (as in `tree`), so the next edits can target them. `--dry-run` runs everything, then puts the files back.

Time, measured on apps/advise: each step takes 10–20ms. Loading React's and the DOM's types takes about 2s, paid once per run (by the package-name check of `component create`, then reused). The final type check takes about 0.5s and `check` about 1s. A whole card takes about 3.7s in all. `REACTSMITH_TIMING=1` prints the split on stderr.

The draft goes through the same code as the element commands, so the two can't drift apart. No separate draft rules are written.

## The grammar

The draft is **one JSX element**: the root. It has no imports, no function, no `return`, no hooks and no props interface.

### Elements

- **A lowercase tag** is an HTML element (`div`, `a`, `img`…), from the same tag list as `element insert`.
- **A PascalCase name** is a component, found as `element insert` finds it: the project's components, packages (`NavLink`), and lucide icons with the `Icon` suffix (`SearchIcon`). When a name is ambiguous, `$from="shared"` (or a feature, `app`, a package) picks one.
- **A prop holding a component** (`icon: LucideIcon`) is written as the prop's name in PascalCase: `<Icon size={16} />` renders `icon`, as `element insert "{icon}"` does.
- **The imports** come from the command, never from the draft.
- **What each element may hold** follows today's rules:
  - layout elements hold elements;
  - text elements hold text;
  - interactive elements, headings and cells hold both;
  - components hold elements only when they declare `children`.

### Attributes (props)

Every attribute without `$` is a prop, as in `--props`:

- literals: `href="/docs"`, `size={16}`, `disabled`, `open={false}`
- names: `{title}`, `{product.price}`, `onClick={toggle}`, `{...product}`
- in a translated app, the component's messages: `aria-label={t('menu')}`

A name must already exist in the component: a prop, a constant or import of the file, or a variable written before the `return`. Otherwise the draft is refused (`value-name-unknown`), with the same rules as `element insert`. When a name is a prop or a constant, the command destructures or imports it as it does today.

These are refused:
- `className` and `style`: styles go through `$` attributes.
- `key` outside a list.
- arrow functions and calls, other than `t()`.
- computed values (`{items.length}`, `{a + b}`).
- JSX inside a prop (`footer={<Button />}`).

### Children

- **Text:** literal text and names mixed, as in `--text`: `<h3>{title}</h3>`, `<p>Hello, {user.name}!</p>`. Whitespace follows JSX's rules.
- **A message:** `<span>{t('register')}</span>` becomes `--message register`, and it must be the element's only child.
- **Elements:** nested to any depth.
- **A list:** `{PRODUCTS.map((product) => <ProductCard key={product.id} {...product} />)}`. This is exactly one parameter and an arrow returning one component with a `key`. Only components repeat. One level of list per file.
- **A condition:** the test is a name, with `!` for the opposite.
  - `{open && <nav />}`, `{!open && <nav />}`
  - `{open ? <a /> : <b />}`
  - `{label ?? <span>None</span>}` (`||` is refused, since `element insert --fallback` writes `??`)

  Each branch is one element or one list. Conditions don't nest.
- **Comments** (`{/* … */}`) are dropped.

### `$` attributes: the styles

Each one is a `style update` option on that element. Values are written exactly as on the command line.

| Attribute | Option | Example |
| --- | --- | --- |
| `$name` | `--name` | `$name="price"` |
| `$direction` | `--direction` | `$direction="column"` |
| `$gap` | `--gap` | `$gap="3"` |
| `$align` | `--align` | `$align="center"` |
| `$justify` | `--justify` | `$justify="between"` |
| `$padding` | `--padding` | `$padding="2 4"` |
| `$css` | `--css` | `$css="border-radius: var(--radius-lg); &:hover { opacity: 0.8 }"` |
| `$css-<state>` | `--state <state> --css` | `$css-hover="opacity: 0.8"`, `$css-placeholder="color: var(--color-text-muted)"` |
| `$css-at-<breakpoint>` | `--at <breakpoint> --css` | `$css-at-mobile="flex-direction: column"` |
| `$css-when-<prop>` | `--when <prop> --css` | `$css-when-selected="font-weight: var(--font-weight-bold)"` |
| `$css-when-<prop>-<value>` | `--when <prop>=<value> --css` | `$css-when-status-Error="color: var(--color-text-danger)"` |
| `$class` | `--class` (Tailwind projects only) | `$class="inline-flex gap-2 hover:underline"` |
| `$from` | `--from` (components only) | `$from="shared"` |

- **The root** has no `$name`: its style is `root`, as it is today.
- **Every other styled element needs `$name`.** Without one, the element gets no style.
- The states are those of `--state`: `hover`, `focus-visible`, `focus-within`, `active`, `disabled`, `current`, `placeholder`, `before`, `after`.
- Values follow today's rules: steps of 4px for `$gap` and `$padding`, and CSS variables only when they are tokens.

## Example

The child first:

```
reactsmith component create ProductCard --feature catalog --interface "image: string; title: string; price: string" --jsx - <<'EOF'
<article $direction="column" $gap="3" $padding="4" $css="border-radius: var(--radius-lg)" $css-hover="box-shadow: var(--shadow-md)">
  <img $name="photo" src={image} alt={title} />
  <h3 $name="title">{title}</h3>
  <span $name="price" $css="font-weight: var(--font-weight-bold)">{price}</span>
</article>
EOF
```

Then the parent:

```
reactsmith component create ProductGrid --feature catalog --jsx - <<'EOF'
<section $direction="row" $gap="4">
  {PRODUCTS.map((product) => <ProductCard key={product.id} {...product} />)}
</section>
EOF
```

## Open

- **Replacing one node:** an optional id that says which node `--replace` replaces. To discuss later.
- **Combining modifiers:** "on hover, on mobile" in one attribute (`$css-at-mobile-hover`?). For now, one modifier per attribute. A combination is done with `style update` afterwards.
- **Responsive layout options:** `$direction-at-mobile`? For now, `$css-at-mobile="flex-direction: column"`.
- **Text and elements in one element:** checked, the order is kept (`<button><SearchIcon />Search</button>`). The elements before the text are inserted with `--position first`. Text on both sides of an element is refused (`draft-text-split`).
- **`{items.length}`** is accepted as text, as `element insert --text` accepts it: a property path counts as a name. The skill calls it a computed value, so one of the two should change.
- **Speed of `--replace`:** about 5s on Advise's SearchBar. The "check before" adds about 1s. Without a `component create` to load them first, React's types load at the first package component instead.
- **The skill:** SKILL.md doesn't mention `--jsx` yet. It should be added before an agent trial.
- **Modifiers in Tailwind projects:** whether `$css-<state>` works, or only `$class` with variants.
- **Slots** (`footer={<Button />}`): refused for now.
- **Views and layouts:** only components for now. `view create --jsx` and `layout create --jsx` may follow.
