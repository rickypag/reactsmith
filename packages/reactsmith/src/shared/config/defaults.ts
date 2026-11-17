/** The tool name. The package name and bin in package.json must match it. */
export const TOOL_NAME = 'reactsmith';

export const CONFIG_FILE = `${TOOL_NAME}.config.json`;

/** Top-level folders inside srcDir. Keys are roles, values are folder names on disk. */
export const DEFAULT_FOLDERS: Readonly<Record<string, string>> = {
  app: 'app',
  assets: 'assets',
  components: 'components',
  config: 'config',
  features: 'features',
  hooks: 'hooks',
  lib: 'lib',
  stores: 'stores',
  testing: 'testing',
  types: 'types',
  utils: 'utils',
};

/** Folders the component flows depend on: they can be renamed but not disabled. */
export const REQUIRED_FOLDERS = ['components', 'features'] as const;

/** Folders allowed inside each feature. There is no api/: views and components each hold their own. */
export const DEFAULT_FEATURE_FOLDERS: Readonly<Record<string, string>> = {
  assets: 'assets',
  components: 'components',
  hooks: 'hooks',
  layouts: 'layouts',
  stores: 'stores',
  types: 'types',
  utils: 'utils',
  views: 'views',
};

export const REQUIRED_FEATURE_FOLDERS = ['components'] as const;

export const UNKNOWN_FOLDER_POLICIES = ['error', 'warn', 'allow'] as const;

export const DEFAULT_ALIAS = '@';

/** Where App.tsx / App.css live: in the app folder, or at the root of srcDir. */
export const APP_FILES_LOCATIONS = ['app', 'root'] as const;

/** Folders allowed inside the app folder, which holds the app shell (layout, router). */
export const DEFAULT_APP_FOLDERS: Readonly<Record<string, string>> = {
  components: 'components',
  layouts: 'layouts',
  styles: 'styles',
  views: 'views',
};

/** Views are named after their page with this suffix: "UserProfileView". */
export const DEFAULT_VIEW_SUFFIX = 'View';

/** At most this many inline style properties (style={{…}}) and plain classes (className="…") per element. */
export const DEFAULT_INLINE_STYLE_LIMIT = 3;

/** The file in the app folder that defines the app's routes, checked when a router is configured. */
export const DEFAULT_APP_ROUTER = 'router.tsx';

/** A feature's public API: the only file code outside the feature may import from. */
export const DEFAULT_FEATURE_PUBLIC_API = 'index.ts';

/** The file in which a feature exports its route definitions. */
export const DEFAULT_FEATURE_ROUTES = 'routes.tsx';

/** The "layoutComponents" key that stands for plain HTML elements instead of an import source. */
export const HTML_SOURCE = 'html';

/**
 * HTML elements whose job is structure. Text, buttons, inputs and the like are content, not layout.
 * Table cells (td, th) and headings hold elements and text (a heading's link or icon), so they are text elements too.
 */
export const HTML_LAYOUT_ELEMENTS = ['div', 'main', 'section', 'article', 'aside', 'dialog', 'details', 'form', 'fieldset', 'header', 'footer', 'nav', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;

/** UI libraries with a layout preset, detected by init from package.json. */
export const LAYOUT_LIBRARIES = ['@mui/material'] as const;

/**
 * Layout components by import source. Commands only insert components inside layout components,
 * and their children are the candidates for extraction. A library preset keeps the semantic HTML
 * elements but drops div and span, which its Box replaces.
 */
export const LAYOUT_PRESETS: Readonly<Record<typeof HTML_SOURCE | (typeof LAYOUT_LIBRARIES)[number], Readonly<Record<string, readonly string[]>>>> = {
  html: { [HTML_SOURCE]: HTML_LAYOUT_ELEMENTS },
  '@mui/material': {
    '@mui/material': ['Box', 'Container', 'Grid', 'Stack'],
    [HTML_SOURCE]: HTML_LAYOUT_ELEMENTS.filter((tag) => tag !== 'div'),
  },
};

/** How components are styled: CSS Modules (the default, built into Vite) or Tailwind classes. */
export const STYLE_LIBRARIES = ['css-modules', 'tailwind'] as const;

export const DEFAULT_STYLES = 'css-modules';

/** Each component file has its own style file: "Sidebar.tsx" → "Sidebar.module.css" or "Sidebar.styles.ts". */
export const STYLE_FILE_SUFFIXES: Readonly<Record<(typeof STYLE_LIBRARIES)[number], string>> = {
  'css-modules': '.module.css',
  tailwind: '.styles.ts',
};

/** HTML elements that hold text. Text anywhere else is reported by check, so the structure stays layout only. */
export const HTML_TEXT_ELEMENTS = ['span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'small', 'caption', 'td', 'th', 'kbd', 'code', 'abbr', 'time', 'mark', 's', 'sub', 'sup', 'b', 'i'] as const;

/** The default text components. Libraries add theirs later, e.g. MUI's Typography. */
export const TEXT_COMPONENTS: Readonly<Record<string, readonly string[]>> = { [HTML_SOURCE]: HTML_TEXT_ELEMENTS };

/**
 * HTML elements people click: they hold text and other elements, e.g. an icon and a label, or a logo and a badge. A
 * label too: its text and the field it names (<label>Email <input /></label>), and a details' summary.
 */
export const HTML_INTERACTIVE_ELEMENTS = ['a', 'button', 'label', 'summary'] as const;

/** The default interactive components, plus the links of the configured router. */
export const INTERACTIVE_COMPONENTS: Readonly<Record<string, readonly string[]>> = { [HTML_SOURCE]: HTML_INTERACTIVE_ELEMENTS };

/** Links of a router library: links inside the app, without reloading the page. */
export const ROUTER_LINKS: Readonly<Record<string, readonly string[]>> = { 'react-router': ['NavLink', 'Link'] };

/** Icon libraries ReactSmith can insert icons from. A project uses only one. */
export const ICON_LIBRARIES = ['lucide-react'] as const;

/** Icon libraries a project may not mix with its configured one: importing them is an error in check. */
export const KNOWN_ICON_LIBRARIES = ['lucide-react', '@mui/icons-material', 'react-icons', '@heroicons/react', '@tabler/icons-react', '@phosphor-icons/react', 'react-feather'] as const;

/**
 * The frameworks ReactSmith knows, set by init from package.json. Vite apps route with a router library (react-router);
 * Next.js routes from its own app folder, so ReactSmith leaves routing to it: no router, no routing checks.
 */
export const FRAMEWORKS = ['vite', 'next'] as const;

/**
 * The screen sizes the app adapts to, by name: each a media query. The styles without one are the default (desktop
 * first here); "style update --at mobile" and the modes of the size tokens apply under the query. Listed in cascade
 * order: a later one wins over an earlier one where both apply.
 */
export const DEFAULT_BREAKPOINTS: Readonly<Record<string, string>> = { mobile: '(max-width: 767px)' };

/** Names a breakpoint can't take: the default mode's, and the variants Tailwind and the style states already use. */
export const RESERVED_BREAKPOINT_NAMES = ['base', 'sm', 'md', 'lg', 'xl', '2xl', 'dark', 'light', 'print', 'hover', 'focus', 'active', 'disabled', 'open', 'current'] as const;

/**
 * The translation libraries ReactSmith writes messages for, detected by init: how a component gets its translator,
 * one per component, named after it (useTranslations('TopBar')), and calls it with a key: t('workshops').
 */
export const I18N_PRESETS = {
  /** `folder`: where its docs put its setup (routing, request config, navigation), in srcDir. */
  'next-intl': { hook: 'useTranslations', from: 'next-intl', messages: 'messages/{locale}.json', folder: 'i18n' },
} as const;

export const I18N_LIBRARIES = Object.keys(I18N_PRESETS) as (keyof typeof I18N_PRESETS)[];

/** The name a component gives its translator: const t = useTranslations('TopBar'). */
export const TRANSLATOR_NAME = 't';

/** Next.js's app folder, in srcDir: its pages and layouts. ReactSmith leaves it to Next and only checks what sits in it. */
export const NEXT_APP_FOLDER = 'app';

/** ReactSmith's app folder in a Next.js app, since Next's takes "app": the shell's components, layouts, styles and views. */
export const NEXT_SHELL_FOLDER = 'shell';

/** Links of a framework that routes by itself: links inside the app, without reloading the page. */
export const FRAMEWORK_LINKS: Readonly<Partial<Record<(typeof FRAMEWORKS)[number], Readonly<Record<string, readonly string[]>>>>> = {
  next: { 'next/link': ['Link'] },
};

export const ROUTER_LIBRARIES = ['react-router'] as const;

/** Supported React Router major versions. */
export const REACT_ROUTER_VERSIONS = [7] as const;

/** Supported router modes. Declarative mode comes next. */
export const ROUTER_MODES = ['data'] as const;

export const DEFAULT_IMPORT_RULES = {
  /** Code outside a feature may only import its public API ("@/features/auth"). */
  featurePublicApiOnly: true,
  /** Features may import from the app folder. */
  featuresImportApp: false,
  /** Shared folders (components, hooks, lib...) may import from features. */
  sharedImportFeatures: false,
  /** Shared folders may import from the app folder. */
  sharedImportApp: false,
} as const;

/**
 * The types of shared components, by group: each type is a folder of src/components ("buttons" → components/buttons),
 * so a dev or an agent looking for a component looks in its type first. Init writes them into the config, where the
 * team can change them. The groups organize the types, e.g. for a picker.
 */
export const DEFAULT_COMPONENT_TYPES: Readonly<Record<string, readonly string[]>> = {
  actions: ['buttons', 'links'],
  forms: ['fields', 'forms'],
  navigation: ['menus', 'tabs', 'breadcrumbs', 'pagination'],
  content: ['cards', 'lists', 'tables', 'badges', 'avatars', 'media'],
  feedback: ['alerts', 'loaders', 'empty-states'],
  overlays: ['dialogs', 'popovers'],
  structure: ['layout', 'typography', 'icons'],
};
