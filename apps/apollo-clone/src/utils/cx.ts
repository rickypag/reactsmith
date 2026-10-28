/** Joins class names, skipping empty ones: cx(styles.root, className). */
export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
