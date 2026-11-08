# How a request becomes code

ReactSmith keeps a React project's structure correct. The CLI writes the structure and the UI, and `check` refuses a bad shape whoever wrote the code, a command or a person. Agents reach the CLI through two skills, each with one job:

```
caller: a developer, or a higher agent (later: Figma, …)
  │  "in the card, add a span named price showing {price}"
  ▼
reactsmith-resolver   loose targets → exact ids                  reads only
  │  "in …/ProductCard.tsx#footer, add a span named price showing {price}"
  ▼
reactsmith            one intent → commands, run with --json     never edits by hand
  │  element insert span --into "…/ProductCard.tsx#footer" --text "{price}" --name price
  ▼
CLI + check           writes the files; check keeps the structure valid
```

The caller decides what to build and where. The skills don't design: they find targets and translate. Each answer has a fixed shape, so a person and an agent can both act on it. The shapes are in [CONTRACT.md](CONTRACT.md).

## The skills

| Skill | Takes | Answers |
| --- | --- | --- |
| [reactsmith-resolver](reactsmith-resolver/SKILL.md) | a request with loose targets: names, visible text, position, file and line, or place | `resolved` (the same request with exact targets), `candidates`, `not found` |
| [reactsmith](reactsmith/SKILL.md) | one intent with exact targets | `commands` (run, with their results), `unsupported`, `unclear` |
| [reactsmith-from-figma](reactsmith-from-figma/SKILL.md) | a Figma link | a plan of commands, for review (parked: a higher layer, not part of v1) |

`init` installs the three skill folders into `.claude/skills/`, and adds the block in [CLAUDE.md](CLAUDE.md) to the project's CLAUDE.md. The pages at this level (this one, [CONTRACT.md](CONTRACT.md), [building-guide.md](building-guide.md)) are not installed.

## The flows

**A precise request.** The targets are already exact, so the resolver is skipped.
```
"Rename ProductCard to GiftCard."
→ commands: component update ProductCard --name GiftCard
```

**A loose request.** The resolver reads the file (`reactsmith tree`) and finds the target, then the translator runs the command.
```
"Make the save button in the product card 70px wide."
→ resolved: "Make features/homepage/components/ProductCard/ProductCard.tsx#save 70px wide."
→ commands: style update "…/ProductCard.tsx#save" --css "width: 70px"
```

**An ambiguous request.** The resolver never guesses. It lists what matches, and the caller picks one.
```
"Make the title bigger."
→ candidates: …/ProductCard.tsx#title (h3), …/ResultsHeading.tsx#title (h2)
```

**A request no command can do.** The translator says what is missing. The caller decides: skip it, or ask for it by hand ([by-hand.md](reactsmith/by-hand.md)), then run `check`.
```
"Add a @keyframes spin to the ResultsHeading styles."
→ unsupported: style update can't write @keyframes
```

**A request that lacks something.** The translator doesn't invent values or design. It asks for what is missing.
```
"Add a card to the homepage."      → unclear: which component, its props, where it goes
"Add a span and make it bold."     → unclear: two intents, send them one at a time
```

**A higher agent.** It decides the components (with [building-guide.md](building-guide.md), parked for now) and sends the translator precise requests, one per intent. Targets it just created are already exact, so it skips the resolver.

## Why it's split this way

- **`check` is the core.** Commands will never cover everything. Hand-written code is fine as long as the structure holds, and `check` makes sure it does.
- **Each layer does as little as possible.** The resolver only reads, the translator only maps words to commands, and the decisions stay with the caller. A small layer is easy to test and hard to get wrong quietly.
- **The same requests work for people and agents.** A developer types them; a higher agent writes them. So the evals cover both.

## Evals

[../evals/translator.yaml](../evals/translator.yaml) holds requests with their expected answers: commands, `unsupported` or `unclear`. The cases come from the advise build, from extra coverage cases, and from the known gaps. They are run by hand: give a subagent the translator skill and one request, ask for `--dry-run`, and compare its commands with the expected ones. Resolver cases come later, once a test app is stable enough to freeze.
