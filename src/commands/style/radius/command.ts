import { RADIUS } from '../../../shared/tokens/sizes.js';
import { tokenCommand } from '../tokens.js';

export const styleRadiusCommand = tokenCommand(RADIUS, 'radius', 'default=0.5rem; card={lg}', 'Radius');
