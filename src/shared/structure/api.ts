/** The folder in a view or component that holds its data access. */
export const API_FOLDER = 'api';

/** Data fetching: a view's main data (used by its loader) or a component's own queries. */
export const QUERIES_FILE = 'queries.ts';

/** Data editing. Only components have it: views load data, the components inside them edit it. */
export const MUTATIONS_FILE = 'mutations.ts';

export const VIEW_API_FILES = [QUERIES_FILE] as const;
export const COMPONENT_API_FILES = [QUERIES_FILE, MUTATIONS_FILE] as const;
