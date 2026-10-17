// src/services/deep-links/link-gates.test.ts
import { linkGates } from './link-gates';

describe('linkGates', () => {
  it('reports a gate closed until its owner opens it, and closed again after', () => {
    expect(linkGates.isOpen('signed-in')).toBe(false);
    linkGates.set('signed-in', true);
    expect(linkGates.isOpen('signed-in')).toBe(true);
    expect(linkGates.isOpen('onboarded')).toBe(false);
    linkGates.set('signed-in', false);
    expect(linkGates.isOpen('signed-in')).toBe(false);
  });
});
