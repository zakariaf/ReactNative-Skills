// src/i18n/t.tsx
import { AppText } from '@/ui/app-text';

import { useT } from './t-context';

import type { MessageValues } from './create-t';
import type { MessageKey } from './messages';
import type { AppTextProps } from '@/ui/app-text';

export type TProps = Omit<AppTextProps, 'children'> & {
  readonly id: MessageKey;
  readonly values?: MessageValues;
};

/**
 * <T id="tasks.summary.open" values={{ openCount }} />: a catalog message rendered by the design
 * system's AppText, so text style, alignment and font scaling come with it.
 */
export function T({ id, values, ...textProps }: TProps): React.JSX.Element {
  const t = useT();
  return <AppText {...textProps}>{t(id, values)}</AppText>;
}
