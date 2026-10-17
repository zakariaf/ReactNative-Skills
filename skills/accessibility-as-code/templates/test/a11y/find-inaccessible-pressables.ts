// test/a11y/find-inaccessible-pressables.ts
// The audit line every screen test ends with. It returns messages instead of calling expect, so it
// stays a plain helper:
//   expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
import type { TestInstance, TestNode } from 'test-renderer';

function isPressable(node: TestInstance): boolean {
  return typeof node.props['onClick'] === 'function' || typeof node.props['onPress'] === 'function';
}

/**
 * A pressable no screen reader focuses (a backdrop, a keyboard-dismiss area) needs no role or name:
 * accessible={false}, or aria-hidden (View.js writes it as accessibilityElementsHidden plus
 * importantForAccessibility="no-hide-descendants"). Its action must be reachable another way.
 */
function isHiddenFromReaders(node: TestInstance): boolean {
  const { props } = node;
  if (props['accessible'] === false || props['aria-hidden'] === true) return true;
  return (
    props['accessibilityElementsHidden'] === true &&
    props['importantForAccessibility'] === 'no-hide-descendants'
  );
}

function hasText(node: TestNode): boolean {
  if (typeof node === 'string') return node.trim() !== '';
  return node.children.some(hasText);
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value !== '';
}

function describeNode(node: TestInstance): string {
  const testId: unknown = node.props['testID'];
  return typeof testId === 'string' ? testId : `<${node.type}>`;
}

/**
 * Every pressable host element that a screen reader can focus needs a role and an accessible name
 * (a label, or visible text inside it). Returns one message per gap, for example
 * 'tasks.add-button: no role'.
 */
export function findInaccessiblePressables(root: TestInstance): readonly string[] {
  return root.queryAll(isPressable).flatMap((node) => {
    if (isHiddenFromReaders(node)) return [];
    const role: unknown = node.props['accessibilityRole'] ?? node.props['role'];
    const label: unknown = node.props['accessibilityLabel'] ?? node.props['aria-label'];
    const problems: string[] = [];
    if (!isNonEmptyString(role)) problems.push(`${describeNode(node)}: no role`);
    if (!isNonEmptyString(label) && !hasText(node)) {
      problems.push(`${describeNode(node)}: no accessible name`);
    }
    return problems;
  });
}
