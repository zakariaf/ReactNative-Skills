// src/ui/app-text.tsx (fixture excerpt): the text primitive, the one importer of Text.
import { Platform, Text } from 'react-native';

import { useTextStyle } from '@/theme/use-text-style';

/** On Android a leading mark sets an explicit paragraph direction (the design system's sanctioned use). */
const DIRECTION_MARK = { rtl: '\u200F', ltr: '\u200E' } as const;

export function AppText(props: {
  readonly children: string;
  readonly align?: 'start' | 'end';
  readonly direction?: 'ltr' | 'rtl';
}): React.JSX.Element {
  const style = useTextStyle(props.align ?? 'start');
  const mark = props.direction !== undefined && Platform.OS === 'android' ? DIRECTION_MARK[props.direction] : '';
  return <Text style={style}>{`${mark}${props.children}`}</Text>;
}
