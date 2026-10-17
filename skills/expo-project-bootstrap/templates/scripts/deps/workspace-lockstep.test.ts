// scripts/deps/workspace-lockstep.test.ts
import { findLockstepDrift, type Manifest } from './workspace-lockstep.ts';

describe('findLockstepDrift', () => {
  it('accepts workspaces that share every specifier and ignores workspace links', () => {
    const manifests = new Map<string, Manifest>([
      ['apps/tasks', { dependencies: { expo: '~57.0.26', '@acme/ui': '*' } }],
      ['apps/notes', { dependencies: { expo: '~57.0.26', '@acme/ui': '*' } }],
    ]);
    expect(findLockstepDrift(manifests)).toStrictEqual([]);
  });

  it('reports a package declared with two specifiers', () => {
    const manifests = new Map<string, Manifest>([
      ['.', { devDependencies: { typescript: '6.0.3' } }],
      ['packages/core', { devDependencies: { typescript: '6.0.2' } }],
    ]);
    expect(findLockstepDrift(manifests)).toStrictEqual([
      'typescript differs between workspaces: .=6.0.3, packages/core=6.0.2',
    ]);
  });
});
