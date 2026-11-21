import { COLORS } from './colors.js';
import type { TokenKind } from './engine.js';
import { RADIUS, SPACING } from './sizes.js';
import { TYPOGRAPHY } from './typography.js';

/** Every kind of design tokens, in the order global.css imports them. */
export const TOKEN_KINDS: TokenKind[] = [COLORS, TYPOGRAPHY, SPACING, RADIUS];
