# The export format

The ReactSmith export plugin and `fetch.mjs` write the same JSON, one file per export in `.reactsmith/figma/`. It follows the Figma REST API ("GET file nodes"), so what you know of the API applies. Read every `*.json` there whose `format` is `reactsmith-figma/1`; when two hold the same node, the newer `exportedAt` wins. Files are named with the screen, its node id and the time (`installation-440-242-20261030-0015.json`), so a new export never replaces an older one: the newest export of a screen is the design now, the one before it is the design the code was built from, and `diff.mjs` compares the two.

```jsonc
{
  "format": "reactsmith-figma/1",
  "source": "plugin",               // or "api" (fetch.mjs)
  "fileKey": "rN54U19ElZDpQzNNAs6qra",
  "exportedAt": "2026-10-29T15:00:00.000Z",
  "roots": ["430:248"],             // the screens exported: frames or components
  "pages": { "430:248": "docs" },   // the Figma page of each root: a view's page is its feature (plugin only)
  "nodes": {
    "430:248": {
      "document": { … },            // the screen and everything in it
      "components": { … },          // the components its instances use, by id
      "componentSets": { … }        // their sets of variants, by id
    }
  },
  "definitions": { "420:536": { … } },  // the components and sets used, with their properties and variants
  "variables": { "VariableID:420:526": { "name": "primary", "collection": "Colors", "type": "COLOR", "values": { "Light": { … } } } }
}
```

## Nodes

Every node has `id`, `name` and `type` (`FRAME`, `TEXT`, `INSTANCE`, `COMPONENT`, `COMPONENT_SET`, `VECTOR`…), and its `children`. What the mapping reads:

| Field | Meaning |
|---|---|
| `layoutMode` (`HORIZONTAL`, `VERTICAL`), `itemSpacing`, `paddingTop/Right/Bottom/Left`, `primaryAxisAlignItems`, `counterAxisAlignItems`, `layoutWrap` | auto layout: `--direction`, `--gap`, `--padding`, `--justify`, `--align` |
| `layoutSizingHorizontal`, `layoutSizingVertical` (`FIXED`, `HUG`, `FILL`), `absoluteBoundingBox` | sizes: fill is `flex: 1`, fixed is a width or height |
| `layoutPositioning: "ABSOLUTE"`, no `layoutMode` on a frame with children | not mapped: report it |
| `fills`, `strokes` (with `boundVariables.color.id`), `individualStrokeWeights`, `strokeWeight`, `cornerRadius`, `effects` | colors (`var(--color-<variable name>)`), borders, radius, shadows |
| `boundVariables` on the node | variables used for spacing or radius |
| `characters`, `style` (`fontFamily`, `fontWeight`, `fontSize`, `lineHeight`, `letterSpacing`, `textCase`) | text and its style |
| `description` (components, sets) | `root: <tag>` and other notes |
| `componentPropertyDefinitions` (sets and standalone components) | the props: `TEXT`, `BOOLEAN`, `VARIANT` (with `variantOptions`), `INSTANCE_SWAP`, `SLOT` |
| `componentPropertyReferences` (layers inside a component) | which property a layer shows (`characters`), hides (`visible`) or swaps (`mainComponent`) |
| `componentId`, `componentProperties` (instances) | which component, and the values set on this instance |
| `visible: false` | hidden in this state (e.g. by a boolean property) |

The API writes `visible` only when false, and leaves out empty lists; the plugin does the same.

## Components

`nodes[root].components` maps a component id to `{ name, description, componentSetId, remote }`; for a variant, `componentSetId` points to its set in `componentSets`, whose `name` is the component's path (`badges/Badge`). `definitions` holds the full node of each set or standalone component used, with its `componentPropertyDefinitions` and its variants as children. `remote: true` means it comes from a library: it has no definition here.

## Variables

`variables` maps the ids that `boundVariables` use to their `name` (the palette role or token: `primary`, `text-muted`), `collection`, `type` and value per mode. The plugin always fills it; `fetch.mjs` fills it only when the plan allows reading variables (Enterprise), otherwise it is empty and the names follow the conventions.
