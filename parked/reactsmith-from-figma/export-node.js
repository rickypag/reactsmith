// ReactSmith export of the node of a Figma link, through the Figma MCP server, in the format the skill reads
// (export-format.md). By default it is the structure alone (STRUCTURE below), read next to the MCP's design context;
// with STRUCTURE false it is the full export the ReactSmith export plugin writes.
//
// Pass this whole file as the code of the MCP's use_figma tool (it only reads), with NODE_IDS set to the link's
// node ("?node-id=12-345" is "12:345") and PART = 1. use_figma returns at most 48,000 bytes, so an export larger
// than that comes in parts: part 1 says how many ("parts"). Run the file again for each other part, with PART set to
// it and EXPORTED_AT to part 1's "exportedAt". Save each result unchanged in .reactsmith/figma/: part 1 as
// <node name>-<node id>-<YYYYMMDD-HHMM>.json (e.g. header-12-345-20261101-1530.json), part 2 as …-part2.json, and so on.
// When the parts have "text" (a node too large by itself), join the texts of all parts in order instead: the joined
// text is the export, saved as one file <node name>-<node id>-<YYYYMMDD-HHMM>.json.

// <export-core> The export itself, shared with export-node.js of the reactsmith-from-figma skill, which runs it on
// the node of a link through the Figma MCP server. Keep the two the same: a test of the reactsmith package checks it.

const FORMAT = 'reactsmith-figma/1';

function has(object, key) {
  return object !== null && typeof object === 'object' && key in object && object[key] !== figma.mixed;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

/** A color channel (0–1) to 3 decimals: enough to give back its 0–255 value exactly (2 decimals turn #a09999 into #a19999). */
function channel(value) {
  return Math.round(value * 1000) / 1000;
}

/** A paint as the REST API writes it: its variable when it has one (its value is in "variables"), else its color. */
function paint(item, variableIds) {
  const result = { type: item.type };
  if (item.visible === false) result.visible = false;
  if (item.opacity !== undefined && item.opacity !== 1) result.opacity = item.opacity;
  if (item.boundVariables && item.boundVariables.color) {
    variableIds.add(item.boundVariables.color.id);
    result.boundVariables = { color: { id: item.boundVariables.color.id } };
  } else if (item.color) {
    result.color = { r: channel(item.color.r), g: channel(item.color.g), b: channel(item.color.b), a: item.opacity === undefined ? 1 : item.opacity };
  }
  return result;
}

/** The variables bound to the node itself (gap, padding, radius…), by field. */
function boundFields(node, variableIds) {
  if (!node.boundVariables) return undefined;
  const fields = {};
  for (const key of Object.keys(node.boundVariables)) {
    if (key === 'fills' || key === 'strokes') continue;
    // A text's bindings (fontSize, fontFamily…) are a list, one per range of the text: the first is the text's.
    const bound = node.boundVariables[key];
    const alias = Array.isArray(bound) ? bound[0] : bound;
    if (alias && alias.id) {
      variableIds.add(alias.id);
      fields[key] = { id: alias.id };
    }
  }
  return Object.keys(fields).length ? fields : undefined;
}

/**
 * What the plugin knows of components while it walks: their summaries, and the definitions still to write.
 * `structure` writes the structure alone (see exportNodes).
 */
function createContext(structure = false) {
  return { components: {}, componentSets: {}, pending: [], definitions: {}, variableIds: new Set(), structure };
}

/** Whether a layer is laid out by auto layout: false for a child of a frame without it, which has a place of its own. */
function inAutoLayout(node) {
  return Boolean(node.parent && node.parent.layoutMode && node.parent.layoutMode !== 'NONE');
}

/**
 * Records the main component of an instance, and queues its definition (the set of variants, or the component), unless
 * the instance is hidden: a layer hidden by hand is set aside, so a component only hidden layers use isn't exported.
 */
async function recordComponent(instance, context, hidden) {
  const main = await instance.getMainComponentAsync();
  if (!main) return undefined;
  const set = main.parent && main.parent.type === 'COMPONENT_SET' ? main.parent : undefined;
  context.components[main.id] = {
    key: main.key,
    name: main.name,
    description: set ? set.description : main.description,
    remote: main.remote,
    componentSetId: set ? set.id : undefined,
  };
  if (set) context.componentSets[set.id] = { key: set.key, name: set.name, description: set.description, remote: set.remote };
  const definition = set || main;
  if (!hidden && !definition.remote && !(definition.id in context.definitions) && context.pending.indexOf(definition) === -1) context.pending.push(definition);
  return main;
}

/**
 * Component properties without their preferred values: the instances an instance swap suggests (a design system lists
 * hundreds of icons there, repeated on every instance), which ReactSmith doesn't read.
 */
function withoutPreferred(properties) {
  return Object.fromEntries(Object.entries(properties).map(([key, property]) => {
    const { preferredValues, boundVariables, ...rest } = property;
    return [key, boundVariables && Object.keys(boundVariables).length ? { ...rest, boundVariables } : rest];
  }));
}

const SHAPES = ['VECTOR', 'BOOLEAN_OPERATION', 'ELLIPSE', 'RECTANGLE', 'POLYGON', 'STAR', 'LINE'];

/**
 * Whether a layer is a picture drawn in Figma: shapes only, at any depth, with at least one vector (a logo, an
 * illustration). A frame with auto layout lays out its children (a row of logos): it is not one picture.
 */
function isGraphic(node) {
  const drawing = (layer) => layer.type === 'GROUP' || (layer.type === 'FRAME' && !(layer.layoutMode && layer.layoutMode !== 'NONE'));
  const shapesOnly = (layer) => SHAPES.includes(layer.type) || (drawing(layer) && 'children' in layer && layer.children.length > 0 && layer.children.every(shapesOnly));
  const hasVector = (layer) => layer.type === 'VECTOR' || layer.type === 'BOOLEAN_OPERATION' || ('children' in layer && layer.children.some(hasVector));
  return shapesOnly(node) && hasVector(node);
}

/**
 * The fields of a written node that differ from another's: not ids, positions or children. A field gone is null.
 * Overrides are compared without their ids, which only say which instance they are on.
 */
function differences(node, base) {
  const changed = {};
  const comparable = (key, value) => {
    if (key === 'absoluteBoundingBox' && value) return JSON.stringify({ width: value.width, height: value.height });
    return JSON.stringify(value, key === 'overrides' ? (inner, item) => (inner === 'id' ? undefined : item) : undefined);
  };
  for (const key of new Set([...Object.keys(node), ...Object.keys(base)])) {
    if (key === 'id' || key === 'children') continue;
    if (comparable(key, node[key]) !== comparable(key, base[key])) changed[key] = node[key] === undefined ? null : node[key];
  }
  return changed;
}

/**
 * A variant as what differs from the default variant of its set, layer by layer: "differences" maps the place of a
 * layer ("" the variant itself, "/0/2" the third child of its first child) to its name and the fields that differ, a
 * whole layer the default doesn't have, or null for one it lacks.
 */
function variantDifferences(variant, base) {
  const layers = {};
  const walk = (node, other, place) => {
    if (!other) {
      layers[place] = node;
      return;
    }
    const changed = differences(node, other);
    if (Object.keys(changed).length) layers[place] = { name: node.name, ...changed };
    const children = node.children || [];
    const others = other.children || [];
    children.forEach((child, index) => walk(child, others[index], `${place}/${index}`));
    for (let index = children.length; index < others.length; index++) layers[`${place}/${index}`] = null;
  };
  walk(variant, base, '');
  return { id: variant.id, name: variant.name, type: variant.type, variantOf: base.id, differences: layers };
}

/**
 * A node as the REST API writes it: the fields ReactSmith reads, and its children. An instance has no children: its
 * layers are its component's (in "definitions"), and only those that differ on this instance are written, under
 * "overrides", each with the fields that differ. `deep` false writes the node alone, as an override is.
 */
async function serialize(node, context, deep = true, hiddenParent = false) {
  const result = { id: node.id, name: node.name, type: node.type };
  // Hidden by hand: no boolean property shows it (a layer a property hides is a condition, built).
  const hidden = hiddenParent || (node.visible === false && !(node.componentPropertyReferences && node.componentPropertyReferences.visible));
  if (node.visible === false) result.visible = false;
  if (has(node, 'description') && node.description) result.description = node.description;
  if (context.structure) {
    // The structure alone: the variables the styles use are still collected, for their names and modes.
    for (const key of ['fills', 'strokes']) if (has(node, key)) node[key].forEach((item) => paint(item, context.variableIds));
    boundFields(node, context.variableIds);
    if (node.type === 'TEXT') result.characters = node.characters;
    if (has(node, 'fills') && node.fills.some((item) => item.type === 'IMAGE' && item.visible !== false)) result.image = true;
  } else {
  // The size where it is a size of its own: fixed, a root or a component, or outside auto layout. The place where it
  // has one: absolute, or in a frame without auto layout, as x and y from its parent's top left corner.
  const absolute = has(node, 'layoutPositioning') && node.layoutPositioning === 'ABSOLUTE';
  const placed = deep && node.parent && node.parent.type !== 'PAGE' && (absolute || !inAutoLayout(node)) && has(node, 'x');
  const sized = !deep || !node.parent || node.type === 'COMPONENT' || node.type === 'COMPONENT_SET' || !has(node, 'layoutSizingHorizontal') ||
    node.layoutSizingHorizontal === 'FIXED' || node.layoutSizingVertical === 'FIXED' || !inAutoLayout(node);
  if (node.absoluteBoundingBox && (sized || absolute)) {
    const box = node.absoluteBoundingBox;
    result.absoluteBoundingBox = { ...(placed ? { x: round(node.x), y: round(node.y) } : {}), width: round(box.width), height: round(box.height) };
  }
  if (has(node, 'rotation') && node.rotation) result.rotation = node.rotation;

  // Auto layout.
  if (has(node, 'layoutMode') && node.layoutMode !== 'NONE') {
    // Zero spaces and the start alignments are the defaults, left out.
    result.layoutMode = node.layoutMode;
    for (const key of ['itemSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']) if (node[key]) result[key] = node[key];
    if (node.primaryAxisAlignItems !== 'MIN') result.primaryAxisAlignItems = node.primaryAxisAlignItems;
    if (node.counterAxisAlignItems !== 'MIN') result.counterAxisAlignItems = node.counterAxisAlignItems;
    if (has(node, 'layoutWrap') && node.layoutWrap !== 'NO_WRAP') result.layoutWrap = node.layoutWrap;
  }
  if (has(node, 'layoutPositioning') && node.layoutPositioning === 'ABSOLUTE') result.layoutPositioning = 'ABSOLUTE';
  if (has(node, 'layoutSizingHorizontal') && node.layoutSizingHorizontal !== 'HUG') result.layoutSizingHorizontal = node.layoutSizingHorizontal;
  if (has(node, 'layoutSizingVertical') && node.layoutSizingVertical !== 'HUG') result.layoutSizingVertical = node.layoutSizingVertical;

  // Fills, strokes, corners, effects.
  if (has(node, 'fills') && node.fills.length) result.fills = node.fills.map((item) => paint(item, context.variableIds));
  if (has(node, 'strokes') && node.strokes.length) {
    result.strokes = node.strokes.map((item) => paint(item, context.variableIds));
    const sides = has(node, 'strokeTopWeight') ? [node.strokeTopWeight, node.strokeRightWeight, node.strokeBottomWeight, node.strokeLeftWeight] : undefined;
    if (sides && sides.some((weight) => weight !== sides[0])) {
      result.individualStrokeWeights = { top: sides[0], right: sides[1], bottom: sides[2], left: sides[3] };
    } else if (sides) {
      result.strokeWeight = sides[0];
    } else if (has(node, 'strokeWeight')) {
      result.strokeWeight = node.strokeWeight;
    }
    if (has(node, 'strokeAlign')) result.strokeAlign = node.strokeAlign;
  }
  if (has(node, 'cornerRadius') && node.cornerRadius) result.cornerRadius = node.cornerRadius;
  if (has(node, 'effects') && node.effects.length) {
    result.effects = node.effects.filter((effect) => effect.visible !== false).map((effect) => ({ type: effect.type, radius: effect.radius, offset: effect.offset, color: effect.color, spread: effect.spread }));
  }
  const bound = boundFields(node, context.variableIds);
  if (bound) result.boundVariables = bound;

  // Text.
  if (node.type === 'TEXT') {
    result.characters = node.characters;
    const style = {};
    if (has(node, 'fontName')) {
      style.fontFamily = node.fontName.family;
      style.fontStyle = node.fontName.style;
    }
    if (has(node, 'fontWeight')) style.fontWeight = node.fontWeight;
    if (has(node, 'fontSize')) style.fontSize = node.fontSize;
    if (has(node, 'lineHeight') && node.lineHeight.unit !== 'AUTO') style.lineHeight = node.lineHeight;
    if (has(node, 'letterSpacing') && node.letterSpacing.value) style.letterSpacing = node.letterSpacing;
    if (has(node, 'textCase') && node.textCase !== 'ORIGINAL') style.textCase = node.textCase;
    result.style = style;
  }
  }

  // Components and their properties.
  // Only sets and standalone components have property definitions: reading them on a variant throws.
  if (node.type === 'COMPONENT_SET' || (node.type === 'COMPONENT' && !(node.parent && node.parent.type === 'COMPONENT_SET'))) {
    result.componentPropertyDefinitions = withoutPreferred(node.componentPropertyDefinitions);
  }
  if (has(node, 'componentPropertyReferences') && node.componentPropertyReferences && Object.keys(node.componentPropertyReferences).length) {
    result.componentPropertyReferences = node.componentPropertyReferences;
  }
  if (node.type === 'INSTANCE') {
    const main = await recordComponent(node, context, hidden);
    if (main) result.componentId = main.id;
    result.componentProperties = withoutPreferred(node.componentProperties);
    // Slots hold the instance's own content, not its component's: written in full, and their layers not again as overrides.
    const slots = deep ? node.findAll((layer) => layer.type === 'SLOT').filter((slot) => {
      for (let parent = slot.parent; parent && parent !== node; parent = parent.parent) if (parent.type === 'INSTANCE') return false;
      return true;
    }) : [];
    const inSlots = new Set(slots.flatMap((slot) => slot.findAll(() => true).map((layer) => layer.id)));
    // Figma lists every layer changed on the instance, nested instances' included: they are written alone.
    const overrides = [];
    for (const override of deep ? node.overrides || [] : []) {
      if (override.id === node.id || inSlots.has(override.id)) continue;
      const layer = await figma.getNodeByIdAsync(override.id);
      if (!layer) continue;
      const written = await serialize(layer, context, false, hidden);
      // Its size is its component's, unless the override changes it.
      if (!override.overriddenFields.some((field) => /width|height|size/i.test(field))) delete written.absoluteBoundingBox;
      written.overriddenFields = override.overriddenFields;
      overrides.push(written);
    }
    if (overrides.length) result.overrides = overrides;
    if (slots.length) {
      result.slots = [];
      for (const slot of slots) result.slots.push(await serialize(slot, context, true, hidden));
    }
    return result;
  }

  // A picture drawn in Figma comes as its SVG, to save as a file: its layers are no use to build. In the structure
  // alone, it is only marked: its file comes with the design context.
  if (deep && node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET' && isGraphic(node)) {
    if (context.structure) result.graphic = true;
    else result.svg = await node.exportAsync({ format: 'SVG_STRING' });
    return result;
  }

  if (deep && 'children' in node) {
    result.children = [];
    for (const child of node.children) result.children.push(await serialize(child, context, true, hidden));
  }
  // A set of variants: the default in full, the others as what differs from it.
  if (deep && node.type === 'COMPONENT_SET' && node.defaultVariant) {
    const base = result.children.find((child) => child.id === node.defaultVariant.id);
    if (base) result.children = result.children.map((child) => (child === base ? child : variantDifferences(child, base)));
  }
  return result;
}

/**
 * The variables the export uses, by id: their names and values per mode, which the REST API gives only on Enterprise
 * plans. A value that is another variable ({ type: "VARIABLE_ALIAS", id }) brings that variable too, through the
 * whole chain, so a token like "Background/Brand/Default" can be written as a reference to "Brand/800".
 */
async function variables(ids) {
  const result = {};
  const pending = [...ids];
  while (pending.length) {
    const id = pending.shift();
    if (id in result) continue;
    const variable = await figma.variables.getVariableByIdAsync(id);
    if (!variable) continue;
    const collection = await figma.variables.getVariableCollectionByIdAsync(variable.variableCollectionId);
    const values = {};
    for (const mode of collection ? collection.modes : []) {
      const value = variable.valuesByMode[mode.modeId];
      const color = value && typeof value === 'object' && 'r' in value;
      values[mode.name] = color ? { r: channel(value.r), g: channel(value.g), b: channel(value.b), a: channel(value.a) } : value;
      if (value && value.type === 'VARIABLE_ALIAS' && !(value.id in result)) pending.push(value.id);
    }
    result[id] = { name: variable.name, collection: collection ? collection.name : undefined, type: variable.resolvedType, values };
    // The name the design's code uses ("var(--sds-color-text-default-default)" in the MCP's design context), when set.
    if (variable.codeSyntax && variable.codeSyntax.WEB) result[id].codeSyntax = variable.codeSyntax.WEB;
  }
  return result;
}

/** The Figma page a node is on: a view's page is its feature. */
function pageOf(node) {
  let current = node;
  while (current && current.type !== 'PAGE') current = current.parent;
  return current ? current.name : undefined;
}

/**
 * The export of some nodes: each one in the REST API's shape, the components they use, and their variables. With
 * `structure`, only what the MCP's design context doesn't say: names, texts, visibility, instances and their props,
 * slots, component properties and variants, and the variables in every mode, without layout, sizes or styles.
 */
async function exportNodes(roots, source, structure = false) {
  const context = createContext(structure);
  const nodes = {};
  for (const node of roots) {
    const document = await serialize(node, context);
    nodes[node.id] = { document, components: context.components, componentSets: context.componentSets };
  }
  // The definitions of the components used, and of those they use in turn.
  while (context.pending.length) {
    const definition = context.pending.shift();
    context.definitions[definition.id] = await serialize(definition, context);
  }
  return {
    format: FORMAT,
    source,
    ...(structure ? { structure: true } : {}),
    fileKey: figma.fileKey,
    exportedAt: new Date().toISOString(),
    roots: roots.map((node) => node.id),
    pages: Object.fromEntries(roots.map((node) => [node.id, pageOf(node)])),
    nodes,
    definitions: context.definitions,
    variables: await variables(context.variableIds),
  };
}
// </export-core>

// <export-parts> An export in parts of at most LIMIT characters: part 1 holds the nodes, their components and the
// variables; the other parts hold the definitions, packed in their order, which is the same on every call. A node too
// large by itself comes as the text of the whole export, in slices ("text") to join in order.
const LIMIT = 45000;

function exportPart(bundle, part) {
  const size = (value) => JSON.stringify(value).length;
  const shell = (fields) => ({ format: bundle.format, source: bundle.source, ...(bundle.structure ? { structure: true } : {}), fileKey: bundle.fileKey, exportedAt: bundle.exportedAt, ...fields });
  const first = shell({ roots: bundle.roots, pages: bundle.pages, nodes: bundle.nodes, definitions: {}, variables: bundle.variables });
  // The definitions, packed in parts; one that alone passes the limit gets a part of its own.
  const packs = [];
  let pack = {};
  for (const [id, definition] of Object.entries(bundle.definitions)) {
    if (Object.keys(pack).length && size(shell({ definitions: { ...pack, [id]: definition } })) > LIMIT) {
      packs.push(pack);
      pack = {};
    }
    pack[id] = definition;
  }
  if (Object.keys(pack).length) packs.push(pack);
  // Everything fits in one: no parts.
  if (size({ ...first, definitions: bundle.definitions }) <= LIMIT) return { ...first, definitions: bundle.definitions };
  // The variables get a part of their own when they don't fit next to the nodes.
  const apart = size(first) > LIMIT;
  const head = apart ? { ...first, variables: {} } : first;
  // The node itself doesn't fit: the whole export as text, in slices to join in order. A slice is sized as returned,
  // its quotes escaped.
  if (size(head) > LIMIT) {
    const text = JSON.stringify(bundle);
    const slices = [];
    for (let at = 0; at < text.length; ) {
      let length = LIMIT;
      while (JSON.stringify(text.slice(at, at + length)).length > LIMIT - 500) length = Math.floor(length * 0.9);
      slices.push(text.slice(at, at + length));
      at += length;
    }
    if (part < 1 || part > slices.length) throw new Error(`There is no part ${part}: this export has ${slices.length} parts.`);
    return { format: bundle.format, exportedAt: bundle.exportedAt, part, parts: slices.length, text: slices[part - 1] };
  }
  const rest = [...(apart ? [{ variables: bundle.variables }] : []), ...packs.map((definitions) => ({ definitions }))];
  const parts = 1 + rest.length;
  if (part === 1) return { ...head, part: 1, parts };
  if (part < 1 || part > parts) throw new Error(`There is no part ${part}: this export has ${parts} parts.`);
  return shell({ roots: [], pages: {}, nodes: {}, definitions: {}, variables: {}, ...rest[part - 2], part, parts });
}
// </export-parts>

// The nodes of the link, the part to return, and for parts after the first, part 1's "exportedAt". STRUCTURE true
// exports the structure alone, next to the MCP's design context, which gives the layout, the values and the images;
// false is the full export, as the plugin writes it.
const NODE_IDS = ['<node id>'];
const PART = 1;
const EXPORTED_AT = '';
const STRUCTURE = true;

if (PART > 1 && !EXPORTED_AT) throw new Error('Set EXPORTED_AT to the "exportedAt" of part 1, so the parts are one export.');
const roots = [];
for (const id of NODE_IDS) {
  const node = await figma.getNodeByIdAsync(id);
  if (!node) throw new Error(`There is no node ${id} in this file: check the link's node-id.`);
  roots.push(node);
}
const bundle = await exportNodes(roots, 'mcp', STRUCTURE);
if (EXPORTED_AT) bundle.exportedAt = EXPORTED_AT;
return exportPart(bundle, PART);
