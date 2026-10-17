// scripts/i18n/icu-walk.ts
import { isPluralElement, isSelectElement, isTagElement } from '@formatjs/icu-messageformat-parser';

import type { MessageFormatElement } from '@formatjs/icu-messageformat-parser';

/**
 * Depth-first visit of every element, including those inside plural/select options and tags.
 * `next` is the sibling that follows the element (the count-needs-plural rule reads it).
 */
export type Visit = (el: MessageFormatElement, next: MessageFormatElement | undefined) => void;

export function walk(elements: readonly MessageFormatElement[], visit: Visit): void {
  elements.forEach((el, index) => {
    visit(el, elements[index + 1]);
    if (isPluralElement(el) || isSelectElement(el)) {
      for (const option of Object.values(el.options)) walk(option.value, visit);
    }
    if (isTagElement(el)) walk(el.children, visit);
  });
}
