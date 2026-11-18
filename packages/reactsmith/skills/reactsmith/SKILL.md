---
name: reactsmith
description: Turns one precise request into ReactSmith CLI commands, in a React project that has a reactsmith.config.json, and runs them. Use for any change to pages, layouts, components, elements, styles, icons or constants in such a project, e.g. "create OfferCard in homepage: an article with the image, the title as h3, and the price in bold", "in ProductCard.tsx#footer, add a span named price showing {price}", "rename ProductCard to GiftCard", "on hover, #root gets color #111827". When the request describes its targets loosely ("the second element in the card"), use the reactsmith-resolver skill first.
---

# ReactSmith: from a request to commands

The project is managed by ReactSmith, a CLI that writes the structure and the UI: features, views (pages), layouts, components, the elements inside them, their styles, and constants. `reactsmith check` keeps the structure valid.

Your job is to **translate**: one request in, the commands that do it out. The caller (the person you talk to, or another agent) decides what to build, and where. You don't design, and you don't edit files by hand.

## The steps

1. **Targets are exact?** Every element is an id (`features/homepage/components/ProductCard/ProductCard.tsx#price`), every component, view or layout a name or a folder (`ProductCard`, `components/buttons/Choice`). If not ("the card", "this row", "the second element"), use the **reactsmith-resolver** skill first, and go on with the request it returns. When it returns candidates or not found, that is your answer.
2. **One intent?** A request that asks for several things ("add a span and make it bold") is answered with `unclear`, listing the intents, so the caller sends them one at a time. A whole component is one intent: creating it with what it shows, or redoing what it shows, is one draft (below), however many elements it has.
3. **A whole component?** Write it as a draft: [A whole component: one draft](#a-whole-component-one-draft). It is one call instead of one command per element.
   **Anything else:** pick the command from the table below, and its flags from the words of the request ([commands.md](commands.md) has every option; `./node_modules/.bin/reactsmith help <command>` prints one).
4. **Run it** from the project root, as `./node_modules/.bin/reactsmith <command> … --json` (not `npx`, which spends seconds finding the package on every run). `--json` never prompts, and returns `ok`, the `actions` (files changed) and the `issues`. Use `--dry-run` when the caller asks for the commands without running them.
   **Several commands** (a request that needs a message and then its element, or a plan): run them as one batch, much faster than one by one. Write them one per line, as you would type them, into `./node_modules/.bin/reactsmith batch --json` (from stdin, or a file: `… batch plan.txt --json`). `T=features/homepage/components/ProductCard/ProductCard.tsx` on its own line sets a variable the next lines use as `"$T#price"`; `#` starts a comment. Every line is checked first: one that isn't valid runs nothing. Then they run in order, each on the code the ones before left, and the first refusal stops the batch: `stoppedAt` is its line and `notRun` the lines after it. The lines before it stay done, so fix that line and run the batch again from it, not from the start. A line that crashed (`internal-error`) stops the batch the same way: do that line by hand ([When ReactSmith is wrong](#when-reactsmith-is-wrong)), then run the batch again from the line after it. With `--dry-run` (on `batch`, not on a line), the batch runs on a copy of the project and changes nothing: it goes on after a refusal, so `refused` lists every refused line at once (one after another may only follow from it), and `check` lists the issues the plan would add. Use it when the caller asks for the commands without running them.
5. **When refused** (`ok: false`), read each issue's `message` and `hint`. A refused command changed nothing. Retry once if the hint says how with what the request gives (another flag, another target). If the hint needs something the request doesn't give, the refusal is your answer. When it looks like ReactSmith is wrong rather than the request, see [When ReactSmith is wrong](#when-reactsmith-is-wrong).
6. **Answer** with one of the three results below.

## A whole component: one draft

When the request gives a component's content (its elements, their text, props and styles), write that content as the JSX the component returns, and run it in one call. [drafts.md](drafts.md) has the full grammar.

```
./node_modules/.bin/reactsmith component create OfferCard --feature homepage --interface "image: string; title: string; price: string" --jsx - --json <<'EOF'
<article $direction="column" $gap="3" $padding="4">
  <img $name="photo" src={image} alt={title} />
  <h3 $name="title">{title}</h3>
  <span $name="price" $css="font-weight: var(--font-weight-bold)">{price}</span>
</article>
EOF
```

- **A new component:** `component create <Name> --feature|--app|--type … --jsx -`, with its props in `--interface`.
- **Redoing what a component shows:** `component create <Name> --replace --jsx -`. Its props and the code before its `return` stay, so a new prop is added first with `component update <Name> --interface …`. A small change to a component goes through the element commands instead.
- **Styles** are `$` attributes on the elements: `$name`, the layout options (`$direction`, `$gap`, `$align`, `$justify`, `$padding`), `$css`, `$css-hover` (any state), `$css-at-mobile`, `$css-when-selected`. Every styled element but the root needs a `$name`.
- **Values** follow the same rules as `--props` and `--text`: literals and names the component has. Logic stays out of the draft: no hooks, no functions, no calls but `t('key')`, no `className` or `style`.
- **Lists** are `{items.map((item) => <Item key={item.id} {...item} />)}`. **Conditions** are `{open && <A />}`, `{open ? <A /> : <B />}` and `{label ?? <A />}`. The root may render `{children}`.
- **Children first:** a component the draft uses must exist, so create the item of a list before the list.
- **Refused:** nothing is written, and each issue starts with `Line N:` of the draft. Fix those lines and run the same command again. On success, the result lists the component's ids for the next edits.

## The answer

Exactly one of:

- **commands:** each command you ran, with its result:
  ```
  commands
  $ ./node_modules/.bin/reactsmith element insert span --into "…/ProductCard.tsx#price" --text "{price}" --name amount --json
    ok: src/features/homepage/components/ProductCard/ProductCard.tsx, ProductCard.module.css
  ```
  A refusal you couldn't fix is reported here too, with its issues.
- **unsupported:** no command does it. Say what is missing: `unsupported — style update can't target ::selection`.
- **unclear:** the request lacks something a command needs. Say what: `unclear — needs the font size (e.g. font-size: 20px)`.

## Never

- **Never invent a value.** A name, text, prop, style, type or place the request doesn't give is left to the command's default. If the command needs it, answer `unclear`. A new element gets `--name` only when the request names it. In a draft, an element the request styles needs a `$name`: when the request doesn't name it, name it after what it shows (`title`, `price`, `photo`).
- **Never design.** "Add a card" or "make a pricing section" is `unclear`: which components, which props and where they live are the caller's decisions.
- **Never write structure or UI by hand.** What no command does is `unsupported`; the caller may then write it by hand, following [by-hand.md](by-hand.md). The one exception is a ReactSmith bug: [When ReactSmith is wrong](#when-reactsmith-is-wrong).
- **Never send logic to a command.** State, effects, handlers, hooks, computed values and data loading are always written by hand, so a request for them is `unsupported — logic, written by hand`. When the person you talk to is the caller, write it yourself following [by-hand.md](by-hand.md), without asking first. Run `./node_modules/.bin/reactsmith check --json` after any hand change: it is fine as long as `check` passes.

When the person you talk to is the caller, run `./node_modules/.bin/reactsmith check --json` once their requests are done, and `npx tsc -b` (or the project's typecheck script) after props or interfaces changed.

## When ReactSmith is wrong

ReactSmith is young, and it has bugs. A refusal whose hint fits the request is not one: follow the hint. It is a bug when:
- the result has the code `internal-error` (the command crashed);
- a command refuses something this skill or [commands.md](commands.md) says it does, and the hint doesn't help;
- a command reports success, but the file doesn't hold what it said (a missing element, a wrong prop, broken code);
- `check` or the type check fails on code a command just wrote, and nothing written by hand is involved.

Then don't keep trying the command (one retry at most), and don't change the request to get around it:
1. **Make the change by hand**, following [by-hand.md](by-hand.md), the way the command would have written it.
2. **Run `./node_modules/.bin/reactsmith check --json`**: it must pass.
3. **Tell the person you talk to**, in your answer, with a report they can paste into an issue at https://github.com/rickypag/reactsmith/issues:
   ```
   bug — <what went wrong, in one line>
   reactsmith <version from `reactsmith version`>
   $ <the command, as run>
   <its output: ok, actions, issues>
   expected: <what the command should have done>
   done by hand instead: <the files changed>
   ```

When the caller is another agent, don't write by hand: answer with the bug report, so the caller decides.

## From the request to a command

| The request asks to | Command |
| --- | --- |
| add a feature (an area of pages) | `feature create <name> --path <path>` |
| add a page | `view create <Name> --feature <f>`, with `--path <p>`, `--index`, or `--path '*'` (not found) |
| move a page to another URL | `view create <Name> --feature <f> --path <p>` (or `--index`) on the existing view |
| add a layout | `layout create [<Name>] [--feature <f>] [--topbar] [--sidebar]` |
| add a component with what it shows | `component create <Name>` with `--feature <f>`, `--app` or `--type <t>`, and `--jsx -` (a draft) |
| add an empty component | `component create <Name>` with `--feature <f>`, `--app` or `--type <t>` |
| redo what a component shows | `component create <Name> --replace --jsx -` (a draft) |
| rename a component, change its props, move it to another owner | `component update <Name>`: `--name`, `--interface`, `--remove-interface`, `--rename-interface old=new`, `--default`, `--feature`/`--app`/`--type` |
| delete a component | `component remove <Name>` |
| add an element (a tag, a component, an icon) | `element insert <tag\|Component\|XIcon> --into <id>` |
| wrap elements in a new one | `element insert <tag> --around <id> [--through <last id>]` |
| show an existing element only sometimes | `element insert "{?test}" --around <id>` |
| change an element's text or props | `element update <id>`: `--text`, `--message`, `--props`, `--remove-props` |
| set the texts of a translated app, in one language | `messages --set "<Component>.<key>=<text>; …" --locale <language>` |
| show a translated text | `element insert <tag> --into <id> --message <key>` (the key inside the component's group: `workshops` for `TopBar.workshops`) |
| remove a translated text | `messages --remove "<Component>.<key>"` (refused while an element shows it) |
| move an element in its file | `element move <id> --into <id> [--position …] [--through <last id>]` |
| remove an element | `element remove <id>`; keep what's inside: `--keep-children` |
| style an element | `style update <id>`: `--css`, `--object`, `--class`, layout options, `--state`, `--when`, `--at`, `--name` |

**In a Next.js app** (`"framework": "next"` in reactsmith.config.json), Next routes the pages from `src/app`, so no command gives a page its URL: `feature create <name>` and `view create <Name> --feature <f>` take no `--path` or `--index` (they are refused), and `layout create` mounts nothing. Each prints the `page.tsx` or `layout.tsx` to write by hand in `src/app/<url>/`, which only renders the view or the layout. The app's own components, views and layouts are in `src/shell/`, not `src/app/`. A component that needs the browser (state, effects, handlers, browser hooks) starts with `'use client'`: the caller writes that line by hand, the commands keep it first, and it is imported like any other component (no extra folder).
| change colors, fonts, spacing or radius tokens | `style palette`, `style typography`, `style spacing`, `style radius` |
| move a Tailwind project's styles to CSS Modules | `style convert --to css-modules` (once, for the whole project; it reports the classes left to write by hand) |
| add, change or remove data | `constant create\|update\|remove <NAME>` with `--feature <f>`, `--app` or `--component <folder>` |

A rename and a move of a component are two requests (two commands).

## From words to flags

| Words | Flag |
| --- | --- |
| "in the homepage feature" | `--feature homepage` |
| "in the app", "used across the app" | `--app` |
| "shared button(s)", "in the shared cards" | `--type buttons`, `--type cards` (the types are `componentTypes` in reactsmith.config.json) |
| "with props a: string, b?: number" | `--interface "a: string; b?: number"` |
| "its root is a button with type='button'" | `--root button --root-props "type='button'"` |
| "named price" | `--name price` |
| "showing {price}", "with the text 'Buy'" | `--text "{price}"`, `--text "Buy"` |
| "with size={16}", "passing {...product}" | `--props "size={16}"`, `--props "{...product}"` |
| "in a row", "as a column" | `--direction row`, `--direction column` |
| "gap 3", "a 12px gap" | `--gap 3` (steps of 4px; a value that isn't a multiple of 4px goes in `--css`) |
| "centered" (across), "centered both ways" | `--align center`; `--align center --justify center` |
| "spaced between" | `--justify between` |
| "padding 16px", "padding 8px 16px" | `--padding 4`, `--padding "2 4"` |
| "first in", "before", "after", "at the end of" | `--position first\|before\|after`; the end is the default |
| "shown only while loading", "unless open" | `--if loading`, `--if "!open"` |
| "the label, or X when there is none" | `--fallback label` |
| "the other branch of {?loading}" | `--into "<id>/{?loading}"` |
| "repeat Card over CARDS, each item card, keyed by card.id" | `--each CARDS --as card --key card.id` |
| "on hover", "when focused", "when something inside is focused", "when disabled", "on the current link" | `--state hover\|focus-visible\|focus-within\|disabled\|current` |
| "the placeholder text", "a ::before/::after" | `--state placeholder\|before\|after`, or `&::placeholder { … }` in `--css` |
| "when selected is true", "when status is Error" | `--when selected`, `--when status=Error` |
| "on mobile", "on phones", "on tablet", "below 768px" | `--at mobile`, `--at tablet`: a breakpoint of `"breakpoints"` in `reactsmith.config.json` (`mobile` by default); a size that isn't one is `unsupported` until it is added there |
| "the Badge from catalog", "the shared Button" | `--from catalog`, `--from shared` (only when the name alone is ambiguous) |

## What the commands need to know

**Ids.** The file from `src/`, `#`, then the element: a name (`#price`), `#root` (the component's outer element), or a path (`#root/nav/a[2]`, `#links/NavLink[3]`, `#results/{?loading}` for a condition). `./node_modules/.bin/reactsmith tree <file>` prints a file's ids, `./node_modules/.bin/reactsmith id <file>:<line>` the id at a line.

**What an element holds:**
- **Layout elements** (`div`, `nav`, `header`, `ul`, `li`, `form`, `fieldset`, `details`…) hold elements, not text.
- **Text elements** (`span`, `p`, `strong`…) hold only text: `--text`.
- **Interactive elements** (`a`, `button`, `label`, `summary`, `NavLink`), **headings** (`h1`…`h6`) and **table cells** (`td`, `th`) hold both: a label its text and the field it names, a heading its text or a link.
- **Components** hold elements only when their props declare `children`.

A request that breaks these (text in a `div`, an element in a `span`) is refused by the command; report the refusal.

**Layout options** (`--direction`, `--gap`, `--align`, `--justify`, `--padding`) work in `component create`, `element insert` and `style update`, on elements that hold others. Buttons and links are already inline rows.

**Lists:** only components repeat, with `--each`, `--as` and `--key`. One level of list per file: nothing is inserted into a list's items.

**Conditions:** the test is a name (a prop, a constant, a body variable), with `!` for the opposite. Each branch is one element or one list; conditions don't nest. `element insert p --into "<id>/{?open}"` adds the other branch; `element remove "<id>/{?open}"` removes the condition.

**Icons** come from lucide-react, with the `Icon` suffix: `element insert SearchIcon --into <id> --props "size={16}"`. An icon given as a prop is typed `LucideIcon`, passed as `--props "icon={WalletIcon}"`, and rendered with `element insert "{icon}" --into <id>`.

**Styles:** colors, fonts, spacing and radius are tokens, used as CSS variables (`var(--color-text-default-secondary)`, `var(--font-weight-bold)`, `var(--space-2)`, `var(--radius-lg)`). A variable that isn't a token is refused; raw values (`#fff`, `14px`) are allowed.

**Translated apps** (`"i18n"` in reactsmith.config.json): every text a reader sees is a message, never `--text`. First its text in the default language (`messages --set "TopBar.register=Iscriviti" --locale it`), then the element (`--message register`), which shows `{t('register')}` and gives the component `const t = useTranslations('TopBar')` the first time. A prop shows a message the same way, as its value: `--props "aria-label={t('menu')}"` (its text set first), never a variable holding `t('menu')`. A component shows only its own group's keys. The other languages come with more `messages --set … --locale en`; `check` lists what is left to translate. Words in the request are the default language's text unless it says otherwise.

**Data** is JSON: `constant create NAV_LINKS --app --value '[…]'`, with `--type "NavLink[]"` when a value must fit a union. The type is a type of the data, from a `types/` folder (written by hand: `unsupported` if it doesn't exist yet), never a component's props: `--type "NavItemProps[]"` is refused. A component's props type is only used in props.

**Values in props and text** are literals, names of the file (props, constants, body variables, imports), and in a translated app the component's messages in props (`{t('key')}`): `--props "onClick={toggle}"`, `--text "Hello, {user.name}!"`. A computed value (`{items.length}`, JSX) is refused: it needs a variable written by hand, so it is `unsupported` until the caller writes one.

**A variable given to a prop** (`--props`, `--root-props`, `component update --default`) is resolved where the element is:
1. a variable, constant or import of the file is used as it is;
2. a prop of the component that holds it is destructured;
3. a missing variable given to a prop of a basic type (a string, number, boolean, union of literals, or list) is declared with a placeholder value, with a `value-placeholder` warning: report it, so the caller gives it its real value;
4. anything else is refused: the variable is missing. Report the refusal.

## Known unsupported

[limits.md](limits.md) lists what no command does: answer `unsupported` without trying for anything in it, and [by-hand.md](by-hand.md) says how each is done by hand.

## Paths in Git Bash

Git Bash on Windows rewrites arguments that start with `/`, so `--path "/"` arrives as a Windows path. Prefix the command with `MSYS_NO_PATHCONV=1`, or use PowerShell.
