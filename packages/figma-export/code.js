// ReactSmith export: writes the selected frames and components as JSON, in the shape of the Figma REST API
// ("GET file nodes"), plus the definitions of the components they use and the names of their variables.
// It runs in the Figma app through the Plugin API, so it needs no token and uses none of the API's limits.

const FORMAT = 'reactsmith-figma/1';

function has(object, key) {
  return object !== null && typeof object === 'object' && key in object && object[key] !== figma.mixed;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

/** A paint as the REST API writes it, with its variable when it has one. */
function paint(item, variableIds) {
  const result = { type: item.type, visible: item.visible !== false };
  if (item.opacity !== undefined && item.opacity !== 1) result.opacity = item.opacity;
  if (item.color) result.color = { r: round(item.color.r), g: round(item.color.g), b: round(item.color.b), a: item.opacity === undefined ? 1 : item.opacity };
  if (item.boundVariables && item.boundVariables.color) {
    variableIds.add(item.boundVariables.color.id);
    result.boundVariables = { color: { type: 'VARIABLE_ALIAS', id: item.boundVariables.color.id } };
  }
  return result;
}

/** The variables bound to the node itself (gap, padding, radius…), by field. */
function boundFields(node, variableIds) {
  if (!node.boundVariables) return undefined;
  const fields = {};
  for (const key of Object.keys(node.boundVariables)) {
    if (key === 'fills' || key === 'strokes') continue;
    const alias = node.boundVariables[key];
    if (alias && alias.id) {
      variableIds.add(alias.id);
      fields[key] = { type: 'VARIABLE_ALIAS', id: alias.id };
    }
  }
  return Object.keys(fields).length ? fields : undefined;
}

/** What the plugin knows of components while it walks: their summaries, and the definitions still to write. */
function createContext() {
  return { components: {}, componentSets: {}, pending: [], definitions: {}, variableIds: new Set() };
}

/** Records the main component of an instance, and queues its definition (the set of variants, or the component). */
async function recordComponent(instance, context) {
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
  if (!definition.remote && !(definition.id in context.definitions) && context.pending.indexOf(definition) === -1) context.pending.push(definition);
  return main;
}

/** A node as the REST API writes it: the fields ReactSmith reads, and its children. */
async function serialize(node, context) {
  const result = { id: node.id, name: node.name, type: node.type };
  if (node.visible === false) result.visible = false;
  if (has(node, 'description') && node.description) result.description = node.description;
  if (node.absoluteBoundingBox) {
    const box = node.absoluteBoundingBox;
    result.absoluteBoundingBox = { x: round(box.x), y: round(box.y), width: round(box.width), height: round(box.height) };
  }
  if (has(node, 'rotation') && node.rotation) result.rotation = node.rotation;

  // Auto layout.
  if (has(node, 'layoutMode') && node.layoutMode !== 'NONE') {
    result.layoutMode = node.layoutMode;
    result.itemSpacing = node.itemSpacing;
    result.paddingTop = node.paddingTop;
    result.paddingRight = node.paddingRight;
    result.paddingBottom = node.paddingBottom;
    result.paddingLeft = node.paddingLeft;
    result.primaryAxisAlignItems = node.primaryAxisAlignItems;
    result.counterAxisAlignItems = node.counterAxisAlignItems;
    if (has(node, 'layoutWrap') && node.layoutWrap !== 'NO_WRAP') result.layoutWrap = node.layoutWrap;
  }
  if (has(node, 'layoutPositioning') && node.layoutPositioning === 'ABSOLUTE') result.layoutPositioning = 'ABSOLUTE';
  if (has(node, 'layoutSizingHorizontal')) result.layoutSizingHorizontal = node.layoutSizingHorizontal;
  if (has(node, 'layoutSizingVertical')) result.layoutSizingVertical = node.layoutSizingVertical;

  // Fills, strokes, corners, effects.
  if (has(node, 'fills') && node.fills.length) result.fills = node.fills.map((item) => paint(item, context.variableIds));
  if (has(node, 'strokes') && node.strokes.length) {
    result.strokes = node.strokes.map((item) => paint(item, context.variableIds));
    if (has(node, 'strokeTopWeight')) {
      result.individualStrokeWeights = { top: node.strokeTopWeight, right: node.strokeRightWeight, bottom: node.strokeBottomWeight, left: node.strokeLeftWeight };
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

  // Components and their properties.
  // Only sets and standalone components have property definitions: reading them on a variant throws.
  if (node.type === 'COMPONENT_SET' || (node.type === 'COMPONENT' && !(node.parent && node.parent.type === 'COMPONENT_SET'))) {
    result.componentPropertyDefinitions = node.componentPropertyDefinitions;
  }
  if (has(node, 'componentPropertyReferences') && node.componentPropertyReferences) result.componentPropertyReferences = node.componentPropertyReferences;
  if (node.type === 'INSTANCE') {
    const main = await recordComponent(node, context);
    if (main) result.componentId = main.id;
    result.componentProperties = node.componentProperties;
  }

  if ('children' in node) {
    result.children = [];
    for (const child of node.children) result.children.push(await serialize(child, context));
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
      values[mode.name] = value;
      if (value && value.type === 'VARIABLE_ALIAS' && !(value.id in result)) pending.push(value.id);
    }
    result[id] = { name: variable.name, collection: collection ? collection.name : undefined, type: variable.resolvedType, values };
  }
  return result;
}

async function exportSelection() {
  const selection = figma.currentPage.selection;
  if (selection.length === 0) return { error: 'Select the frames or components to export, then run the plugin again.' };

  const context = createContext();
  const nodes = {};
  for (const node of selection) {
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
    source: 'plugin',
    fileKey: figma.fileKey,
    exportedAt: new Date().toISOString(),
    roots: selection.map((node) => node.id),
    // The Figma page of each root: a view's page is its feature.
    pages: Object.fromEntries(selection.map((node) => [node.id, figma.currentPage.name])),
    nodes,
    definitions: context.definitions,
    variables: await variables(context.variableIds),
  };
}

figma.showUI(__html__, { width: 480, height: 420 });
exportSelection().then(
  (result) => {
    // The names and the node ids: two exports never share a file name, so saving one never replaces another.
    const names = figma.currentPage.selection.map((node) => `${node.name}-${node.id.replace(':', '-')}`);
    // With the date and time: a new export never replaces an older one, which updates compare it with.
    const stamp = result.exportedAt ? result.exportedAt.slice(0, 16).replace(/[-:]/g, '').replace('T', '-') : '';
    figma.ui.postMessage({ type: 'export', result, fileName: `${[names.join('-') || 'figma', stamp].filter(Boolean).join('-').replace(/[^\w-]+/g, '-').replace(/-+/g, '-').toLowerCase()}.json` });
  },
  (error) => figma.ui.postMessage({ type: 'export', result: { error: String(error && error.message ? error.message : error) } }),
);
figma.ui.onmessage = (message) => {
  if (message && message.type === 'close') figma.closePlugin();
  if (message && message.type === 'copied') figma.notify('Copied: paste it to Claude, or save it in .reactsmith/figma/');
};
