// src/i18n/direction.ts: the one module that reads the native layout direction.
import { I18nManager } from 'react-native';

export function readLayoutDirection(): 'ltr' | 'rtl' {
  return I18nManager.isRTL ? 'rtl' : 'ltr';
}
