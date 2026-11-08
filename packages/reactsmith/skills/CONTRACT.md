# Resolver and translator: the contract

How a request goes from words to ReactSmith commands. Two skills share the work:
- the **resolver** finds the exact targets,
- the **translator** turns one intent into commands.

The resolver skill, the translator skill and the evals all follow this page. (The page itself is not installed into projects. `init` installs only the skill folders.)

```
caller (user or higher agent)
  │  request, targets described loosely
  ▼
resolver ── candidates / not found ──▶ back to caller
  │  same request, exact targets
  ▼
translator ── unsupported / unclear ──▶ back to caller
  │
  ▼
commands run, results back to caller
```

A caller that already has exact targets, such as a higher agent that just created the files, can skip the resolver.

## Targets

A target is an element or a component. Its exact form:

| Target | Exact form | Example |
| --- | --- | --- |
| Element | file from `src/`, `#`, then the element's name or path | `features/homepage/components/ProductCard/ProductCard.tsx#price` |
| Component | its folder from `src/` | `features/homepage/components/ProductCard` |
| View, layout | same as a component | `features/homepage/views/SearchView` |
| Feature | its name | `homepage` |

Element ids are the ones `reactsmith tree` prints: a name (`#price`), `#root`, or a path (`#root/div[2]`, `#content/span[1]`).

## Resolver

**In:** a request whose targets are described loosely. A target can be described by:
- **Name:** "the price", "the ProductCard"
- **Visible text:** "the button that says Buy"
- **Position:** "the second element in the card", "the last chip"
- **File and line:** `ProductCard.tsx:24`
- **Place:** "the Badge from catalog", "the shared Choice button"

Targets that are already exact pass through unchanged.

**Does:** reads the project to find each target: file search, `reactsmith tree <file>`, `reactsmith id <file>:<line>`. It changes nothing, and it doesn't judge the intent.

**Out:** exactly one of:

- **resolved:** the same request with every target exact. All other words stay as they were.
  ```
  resolved
  request: In features/homepage/components/ProductCard/ProductCard.tsx#titleRow, add the Badge component from components/badges/Badge with label="New"
  ```
- **candidates:** a target matches more than one thing. Each candidate is listed with what tells them apart: tag, name, text.
  ```
  candidates
  target: "the title"
  - features/homepage/components/ProductCard/ProductCard.tsx#title   h3 "{title}"
  - features/homepage/components/ResultsHeading/ResultsHeading.tsx#title   h2 "{title}"
  ```
- **not found:** what it looked for, and where.
  ```
  not found
  target: "the Badge from catalog"
  looked in: features/catalog (no such feature), components/*/Badge (none)
  ```

**Rules:**
- **Never guess.** When two or more things match, return candidates, even when one seems more likely. A wrong target that still works is the worst outcome: the command succeeds, `check` passes, and the change lands in the wrong place.
- **Position counts elements as `tree` shows them, starting at 1.** "The second element in the card" is the second child of the card's `#root`.
- **Prefer names in the output.** When the target has a name, return `#price`, not `#root/div[2]/span[1]`.

## Translator

**In:** one intent, with exact targets and the values it needs.
```
In features/homepage/components/ProductCard/ProductCard.tsx#titleRow, add the Badge component from components/badges/Badge with label="New"
```

**Does:** picks the command and flags that do the intent, then runs them with `--json`. It never edits a file by hand.

**Out:** exactly one of:

- **commands:** each command run, with its result (`ok`, the files changed, any issues).
  ```
  commands
  $ npx reactsmith element insert Badge --from components/badges/Badge --into "features/homepage/components/ProductCard/ProductCard.tsx#titleRow" --props 'label="New"' --json
    ok: features/homepage/components/ProductCard/ProductCard.tsx
  ```
  A refused command counts as a result: it is reported with its issues, and it changed nothing.
- **unsupported:** no command does this. Says what is missing.
  ```
  unsupported
  intent: style the input's placeholder
  missing: style update can't target ::placeholder
  ```
- **unclear:** the intent can't be done as asked. Says what is needed.
  ```
  unclear
  needs: the props of the new component (e.g. "with props image: string, title: string")
  ```

**Rules:**
- **One intent per request.** A request with several intents ("add a span and make it bold") gets `unclear`, with the intents listed, so the caller sends them one at a time. (Short fixed recipes may be allowed later. Open.)
- **Never invent values.** A name, text, prop, style or type the request doesn't give is left to the command's default, or the result is `unclear` when the command needs it.
- **Never design.** "Add a card" is `unclear`. Which components, which props and where they live are the caller's decisions.
- **A refused command is retried only with its hint.** If the hint asks for something the request doesn't give, return the refusal as the result.

## Caller

| Result | Next step |
| --- | --- |
| resolved | the request goes to the translator (the agent running both does this itself) |
| candidates | pick one, or describe the target better |
| not found | fix the description, or create the target first |
| commands | done; run `npx reactsmith check` at the end of a batch of requests |
| unsupported | write it by hand if needed, then run `npx reactsmith check` |
| unclear | rephrase with what `needs` asks for |

## Evals

Each eval case gives the input and the expected output, in the shapes above:
- **Resolver cases:** a loose request and a fixture state → `resolved` (the exact request), `candidates` (the list) or `not found`.
- **Translator cases:** an exact request → `commands` (compared after parsing, so flag order and quoting don't matter), `unsupported` or `unclear`.
