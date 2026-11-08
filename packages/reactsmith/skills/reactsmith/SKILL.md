---
name: reactsmith
description: Turns one precise request into ReactSmith CLI commands, in a React project that has a reactsmith.config.json, and runs them. Use for any change to pages, layouts, components, elements, styles, icons or constants in such a project, e.g. "in ProductCard.tsx#footer, add a span named price showing {price}", "rename ProductCard to GiftCard", "on hover, #root gets color #111827". When the request describes its targets loosely ("the second element in the card"), use the reactsmith-resolver skill first.
---

# ReactSmith: from a request to commands

The project is managed by ReactSmith, a CLI that writes the structure and the UI: features, views (pages), layouts, components, the elements inside them, their styles, and constants. `reactsmith check` keeps the structure valid.

Your job is to **translate**: one request in, the commands that do it out. The caller (the person you talk to, or another agent) decides what to build, and where. You don't design, and you don't edit files by hand.

## The steps

1. **Targets are exact?** Every element is an id (`features/homepage/components/ProductCard/ProductCard.tsx#price`), every component, view or layout a name or a folder (`ProductCard`, `components/buttons/Choice`). If not ("the card", "this row", "the second element"), use the **reactsmith-resolver** skill first, and go on with the request it returns. When it returns candidates or not found, that is your answer.
2. **One intent?** A request that asks for several things ("add a span and make it bold") is answered with `unclear`, listing the intents, so the caller sends them one at a time.
3. **Pick the command** from the table below, and its flags from the words of the request ([commands.md](commands.md) has every option; `npx reactsmith help <command>` prints one).
4. **Run it** from the project root, as `npx reactsmith <command> … --json`. `--json` never prompts, and returns `ok`, the `actions` (files changed) and the `issues`. Use `--dry-run` when the caller asks for the commands without running them.
5. **When refused** (`ok: false`), read each issue's `message` and `hint`. A refused command changed nothing. Retry once if the hint says how with what the request gives (another flag, another target). If the hint needs something the request doesn't give, the refusal is your answer.
6. **Answer** with one of the three results below.

## The answer

Exactly one of:

- **commands:** each command you ran, with its result:
  ```
  commands
  $ npx reactsmith element insert span --into "…/ProductCard.tsx#price" --text "{price}" --name amount --json
    ok: src/features/homepage/components/ProductCard/ProductCard.tsx, ProductCard.module.css
  ```
  A refusal you couldn't fix is reported here too, with its issues.
- **unsupported:** no command does it. Say what is missing: `unsupported — style update can't target ::placeholder`.
- **unclear:** the request lacks something a command needs. Say what: `unclear — needs the font size (e.g. font-size: 20px)`.

## Never

- **Never invent a value.** A name, text, prop, style, type or place the request doesn't give is left to the command's default. If the command needs it, answer `unclear`. A new element gets `--name` only when the request names it.
- **Never design.** "Add a card" or "make a pricing section" is `unclear`: which components, which props and where they live are the caller's decisions.
- **Never edit a file by hand.** What no command does is `unsupported`. Only when the caller then asks you to write it by hand, follow [by-hand.md](by-hand.md), and run `npx reactsmith check --json` after.

When the person you talk to is the caller, run `npx reactsmith check --json` once their requests are done, and `npx tsc -b` (or the project's typecheck script) after props or interfaces changed.

## From the request to a command

| The request asks to | Command |
| --- | --- |
| add a feature (an area of pages) | `feature create <name> --path <path>` |
| add a page | `view create <Name> --feature <f>`, with `--path <p>`, `--index`, or `--path '*'` (not found) |
| move a page to another URL | `view create <Name> --feature <f> --path <p>` (or `--index`) on the existing view |
| add a layout | `layout create [<Name>] [--feature <f>] [--topbar] [--sidebar]` |
| add a component | `component create <Name>` with `--feature <f>`, `--app` or `--type <t>` |
| rename a component, change its props, move it to another owner | `component update <Name>`: `--name`, `--interface`, `--remove-interface`, `--rename-interface old=new`, `--default`, `--feature`/`--app`/`--type` |
| delete a component | `component remove <Name>` |
| add an element (a tag, a component, an icon) | `element insert <tag\|Component\|XIcon> --into <id>` |
| wrap elements in a new one | `element insert <tag> --around <id> [--through <last id>]` |
| show an existing element only sometimes | `element insert "{?test}" --around <id>` |
| change an element's text or props | `element update <id>`: `--text`, `--props`, `--remove-props` |
| move an element in its file | `element move <id> --into <id> [--position …] [--through <last id>]` |
| remove an element | `element remove <id>`; keep what's inside: `--keep-children` |
| style an element | `style update <id>`: `--css`, `--object`, `--class`, layout options, `--state`, `--when`, `--name` |
| change colors, fonts, spacing or radius tokens | `style palette`, `style typography`, `style spacing`, `style radius` |
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
| "on hover", "when focused", "when disabled", "on the current link" | `--state hover\|focus-visible\|disabled\|current` |
| "when selected is true", "when status is Error" | `--when selected`, `--when status=Error` |
| "the Badge from catalog", "the shared Button" | `--from catalog`, `--from shared` (only when the name alone is ambiguous) |

## What the commands need to know

**Ids.** The file from `src/`, `#`, then the element: a name (`#price`), `#root` (the component's outer element), or a path (`#root/nav/a[2]`, `#links/NavLink[3]`, `#results/{?loading}` for a condition). `npx reactsmith tree <file>` prints a file's ids, `npx reactsmith id <file>:<line>` the id at a line.

**What an element holds:**
- **Layout elements** (`div`, `nav`, `header`, `ul`, `li`…) hold elements, not text.
- **Text elements** (`span`, `p`, `h1`…`h6`, `label`) hold only text: `--text`.
- **Interactive elements** (`a`, `button`, `NavLink`) and **table cells** (`td`, `th`) hold both.
- **Components** hold elements only when their props declare `children`.

A request that breaks these (text in a `div`, an element in a `span`) is refused by the command; report the refusal.

**Layout options** (`--direction`, `--gap`, `--align`, `--justify`, `--padding`) work in `component create`, `element insert` and `style update`, on elements that hold others. Buttons and links are already inline rows.

**Lists:** only components repeat, with `--each`, `--as` and `--key`. One level of list per file: nothing is inserted into a list's items.

**Conditions:** the test is a name (a prop, a constant, a body variable), with `!` for the opposite. Each branch is one element or one list; conditions don't nest. `element insert p --into "<id>/{?open}"` adds the other branch; `element remove "<id>/{?open}"` removes the condition.

**Icons** come from lucide-react, with the `Icon` suffix: `element insert SearchIcon --into <id> --props "size={16}"`. An icon given as a prop is typed `LucideIcon`, passed as `--props "icon={WalletIcon}"`, and rendered with `element insert "{icon}" --into <id>`.

**Styles:** colors, fonts, spacing and radius are tokens, used as CSS variables (`var(--color-text-default-secondary)`, `var(--font-weight-bold)`, `var(--space-2)`, `var(--radius-lg)`). A variable that isn't a token is refused; raw values (`#fff`, `14px`) are allowed.

**Data** is JSON: `constant create NAV_LINKS --app --value '[…]'`, with `--type "NavLink[]"` when a value must fit a union. The type is a type of the data, from a `types/` folder (written by hand: `unsupported` if it doesn't exist yet), never a component's props: `--type "NavItemProps[]"` is refused. A component's props type is only used in props.

**Values in props and text** are literals or names of the file (props, constants, body variables, imports): `--props "onClick={toggle}"`, `--text "Hello, {user.name}!"`. A computed value (`{items.length}`, JSX) is refused: it needs a variable written by hand, so it is `unsupported` until the caller writes one.

**A variable given to a prop** (`--props`, `--root-props`, `component update --default`) is resolved where the element is:
1. a variable, constant or import of the file is used as it is;
2. a prop of the component that holds it is destructured;
3. a missing variable given to a prop of a basic type (a string, number, boolean, union of literals, or list) is declared with a placeholder value, with a `value-placeholder` warning: report it, so the caller gives it its real value;
4. anything else is refused: the variable is missing. Report the refusal.

## Known unsupported

Answer `unsupported` without trying for:
- logic: state, effects, handlers, computed values (written by hand);
- styles `--css` can't express: `::placeholder` and other pseudo-elements, `@keyframes`, child selectors, media queries, removing a declaration;
- moving a constant; moving an element to another file;
- removing or renaming a view or a feature; moving a view to another feature; deleting a layout;
- JSX as a prop value (`endIcon={<X />}`); prose with inline elements (a `<code>` inside a `p`).

[by-hand.md](by-hand.md) says how each is done by hand, for when the caller asks.

## Paths in Git Bash

Git Bash on Windows rewrites arguments that start with `/`, so `--path "/"` arrives as a Windows path. Prefix the command with `MSYS_NO_PATHCONV=1`, or use PowerShell.
