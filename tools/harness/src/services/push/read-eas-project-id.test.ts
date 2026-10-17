// src/services/push/read-eas-project-id.test.ts
import { readEasProjectId } from './read-eas-project-id';

const ID = '0f3c3f0e-6a5e-4c55-9a59-2c1f5b2f7e10';

describe('readEasProjectId', () => {
  it('prefers the id EAS Build wrote', () => {
    const source = {
      easConfig: { projectId: ID },
      expoConfig: { extra: { eas: { projectId: 'x' } } },
    };
    expect(readEasProjectId(source)).toBe(ID);
  });

  it('falls back to extra.eas.projectId', () => {
    expect(readEasProjectId({ expoConfig: { extra: { eas: { projectId: ID } } } })).toBe(ID);
  });

  it.each([
    ['nothing', {}],
    ['no eas block', { expoConfig: { extra: {} } }],
    ['a number', { expoConfig: { extra: { eas: { projectId: 7 } } } }],
    ['an empty id', { easConfig: { projectId: ' ' } }],
  ])('returns null for %s', (_label, source) => {
    expect(readEasProjectId(source)).toBeNull();
  });

  it('reads expo-constants by default', () => {
    expect(readEasProjectId()).toBeNull();
  });
});
