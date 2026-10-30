# ReactSmith export (Figma plugin)

Exports the frames and components you select in Figma as JSON for ReactSmith: the same format `fetch.mjs` writes (see `export-format.md` in the `reactsmith-from-figma` skill), without the Figma API. So it needs no token, and none of the API's limits apply (a View or Collab seat, as on the free plan, gets 20 API reads a month). It also exports the names of the variables, which the API gives only on Enterprise plans.

The plugin reads the selection and nothing else: it makes no network requests (`"networkAccess": { "allowedDomains": ["none"] }`).

## Install it (once)

Until it is published, it runs as a development plugin, which needs the Figma desktop app:

1. Open a file in the Figma desktop app.
2. Main menu → **Plugins → Development → Import plugin from manifest…**, and select `packages/figma-export/manifest.json`.

Figma reloads the plugin's files every time it runs: after a change, just run it again.

## Use it

1. Select the screens to export: frames (a view, the root layout) or components. Select several at once to export them together.
2. **Plugins → Development → ReactSmith export.**
3. **Download** the file into the project's `.reactsmith/figma/` folder, or **Copy** it and paste it to Claude.

The export holds the selected nodes with everything in them, the definitions of the components they use (properties and variants), and the variables they use.
