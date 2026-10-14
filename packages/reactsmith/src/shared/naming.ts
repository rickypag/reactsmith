export const NAMING_STYLES = ['kebab-case', 'camelCase'] as const;
export type NamingStyle = (typeof NAMING_STYLES)[number];

const PATTERNS: Record<NamingStyle, RegExp> = {
  'kebab-case': /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
  camelCase: /^[a-z][a-zA-Z0-9]*$/,
};

export function matchesNaming(name: string, style: NamingStyle): boolean {
  return PATTERNS[style].test(name);
}

/** Splits any casing ("userProfile", "UserProfile", "user_profile", "user-profile") into lowercase words. */
function toWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_\-.]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

/** Converts a name to the given style, used to suggest a fix. */
export function toNaming(name: string, style: NamingStyle): string {
  const words = toWords(name);
  if (style === 'kebab-case') return words.join('-');
  return words.map((word, i) => (i === 0 ? word : word[0]!.toUpperCase() + word.slice(1))).join('');
}

/** "user-profile" → "UserProfile" */
export function toPascalCase(name: string): string {
  return toWords(name)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join('');
}

/** "user-profile" → "userProfile" */
export function toCamelCase(name: string): string {
  return toNaming(name, 'camelCase');
}

/** "user-profile" → "User profile", for generated headings. */
export function toTitle(name: string): string {
  const text = toWords(name).join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
