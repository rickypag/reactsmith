import { describe, expect, it } from 'vitest';
import { matchesNaming, toNaming } from '../../src/shared/naming.js';

describe('matchesNaming', () => {
  it.each([
    ['auth', true, true],
    ['user-profile', true, false],
    ['userProfile', false, true],
    ['UserProfile', false, false],
    ['user_profile', false, false],
    ['user--profile', false, false],
    ['-user', false, false],
    ['v2-api', true, false],
  ])('%s → kebab-case: %s, camelCase: %s', (name, kebab, camel) => {
    expect(matchesNaming(name, 'kebab-case')).toBe(kebab);
    expect(matchesNaming(name, 'camelCase')).toBe(camel);
  });
});

describe('toNaming', () => {
  it.each(['userProfile', 'UserProfile', 'user_profile', 'user-profile', 'USER_PROFILE'])('converts %s', (name) => {
    expect(toNaming(name, 'kebab-case')).toBe('user-profile');
    expect(toNaming(name, 'camelCase')).toBe('userProfile');
  });
});
