# ReactSmith

A CLI that gives React projects a feature-based structure and builds them with commands: features, views, layouts, components, elements, styles and design tokens. `reactsmith check` validates the structure, so a project stays consistent whether a developer or an AI agent changes it.

```sh
npm install -D reactsmith
npx reactsmith init
npx reactsmith help
```

It works on Vite and Next.js (App Router) projects with TypeScript. With Claude Code, `init` also installs a skill that turns precise requests ("create OfferCard in the homepage feature: an article with the image, the title as an h3 and the price in bold") into commands.

> **Status: 0.1, early.** It works on real projects, but expect rough edges and changes between versions.

**[Read the full guide](packages/reactsmith/README.md)**: setup, building a layout, batching commands, what to change by hand, and how to report a bug.

## Repository

| Path | What it is |
|---|---|
| [packages/reactsmith](packages/reactsmith) | The `reactsmith` package published to npm: CLI, templates and the Claude Code skill. |

### Working on ReactSmith

Node.js 22.13 or later.

```sh
npm install
npm test        # vitest, the reactsmith package
npm run build   # compiles to packages/reactsmith/dist
```

## Issues

Bugs and ideas go to [GitHub issues](https://github.com/rickypag/reactsmith/issues). The guide's [Reporting a bug](packages/reactsmith/README.md#reporting-a-bug) section says what to include.

## License

[MIT](packages/reactsmith/LICENSE)
