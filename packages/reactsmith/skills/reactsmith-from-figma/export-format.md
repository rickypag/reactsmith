# The export format

The ReactSmith export plugin and `fetch.mjs` write the same JSON, one file per export in `.reactsmith/figma/`. It follows the Figma REST API ("GET file nodes"), so what you know of the API applies. Read every `*.json` there whose `format` is `reactsmith-figma/1`; when two hold the same node, the newer `exportedAt` wins. Files are named with the screen, its node id and the time (`installation-440-242-20261030-0015.json`), so a new export never replaces an older one: the newest export of a screen is the design now, the one before it is the design the code was built from, and `diff.mjs` compares the two.

```jsonc
{
  "format": "reactsmith-figma/1",
  "source": "plugin",               // or "mcp" (export-node.js through the Figma MCP server), or "api" (fetch.mjs)
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
| `fills`, `strokes` (with `boundVariables.color.id`), `individualStrokeWeights`, `strokeWeight`, `cornerRadius`, `effects` | colors (`var(--color-<variable path>)`), borders, radius, shadows |
| `boundVariables` on the node | variables used for spacing or radius |
| `characters`, `style` (`fontFamily`, `fontWeight`, `fontSize`, `lineHeight`, `letterSpacing`, `textCase`) | text and its style |
| `description` (components, sets) | `root: <tag>` and other notes |
| `componentPropertyDefinitions` (sets and standalone components) | the props: `TEXT`, `BOOLEAN`, `VARIANT` (with `variantOptions`), `INSTANCE_SWAP`, `SLOT` |
| `componentPropertyReferences` (layers inside a component) | which property a layer shows (`characters`), hides (`visible`) or swaps (`mainComponent`) |
| `componentId`, `componentProperties` (instances) | which component, and the values set on this instance |
| `visible: false` | hidden: by a boolean property in this state (a condition), or by hand when no property refers to it (set aside, not built) |

The API writes `visible` only when false, and leaves out empty lists. The plugin and `export-node.js` write less, to keep an export small enough to read in one go:

- **Defaults are left out:** a missing `itemSpacing` or padding is 0, a missing alignment is `MIN`, a missing sizing is `HUG`. Four equal stroke weights are one `strokeWeight`.
- **Sizes only where they are one:** `absoluteBoundingBox` holds `width` and `height` for roots, components, fixed sizes and layers outside auto layout, and `x`, `y` only for absolute positioning.
- **Variables by id:** a paint bound to a variable is `{ "type": "SOLID", "boundVariables": { "color": { "id": … } } }`, without its color (it is in `variables`); a node's `boundVariables` are `{ "id": … }` too.
- **Instances have no `children`:** their layers are their component's, in `definitions`. The layers that differ on the instance are under `overrides`, each written alone (its own fields, no children) with `overriddenFields`, the fields that differ (`fills`, `characters`, `visible`…). Its `id` (`I<instance>;<layer>`) ends with the layer's id in the component.
- **Variants:** a set's default variant is written in full; each other variant is `{ id, name, type, variantOf, differences }`, where `differences` maps the place of a layer (`""` the variant itself, `"/0/2"` the third child of its first child) to its `name` and the fields that differ, a whole layer the default doesn't have, or `null` for one it lacks.
- **Slots:** an instance's `slots` hold the content of its slots (a slot belongs to the instance, not to its component), written in full: the instances in a nav list, the cards of a grid. Their layers are not repeated under `overrides`.
- **Drawn pictures:** a layer made only of shapes with a vector in it (a logo) has `svg`, its SVG markup, instead of its layers.
- **Hidden by hand:** a layer hidden with no property behind it is written (with `visible: false`), but the components only such layers use have no definition.

- **In parts:** an export read through the MCP server (`export-node.js`) larger than what the server returns comes as several files of one export, with the same `exportedAt` and `"part": n, "parts": N`. Part 1 has the `roots`, `nodes` and `variables` (or the variables come in part 2 when they don't fit); the others only `definitions`. Read them together.

`fetch.mjs` (the REST API) writes every layer in full; read both shapes the same way.

## Components

`nodes[root].components` maps a component id to `{ name, description, componentSetId, remote }`; for a variant, `componentSetId` points to its set in `componentSets`, whose `name` is the component's path (`badges/Badge`). `definitions` holds the node of each set or standalone component used, with its `componentPropertyDefinitions` and its variants as children (the non-default ones as differences, see above). `remote: true` means it comes from a library: it has no definition here.

## Variables

`variables` maps the ids that `boundVariables` use to their `name` (a path in the palette: `Text/Default/Secondary`), `collection`, `type` and value per mode. A value that is another variable is `{ "type": "VARIABLE_ALIAS", "id": … }`: the plugin also exports the variables aliases point to, so the chain can be followed. The plugin always fills it; `fetch.mjs` fills it only when the plan allows reading variables (Enterprise), otherwise it is empty and the names follow the conventions.
