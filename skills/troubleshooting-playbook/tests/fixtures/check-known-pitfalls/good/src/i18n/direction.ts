// src/i18n/direction.ts
import { reloadAppAsync } from 'expo';
import { I18nManager } from 'react-native';

export async function restartForDirection(isRtl: boolean): Promise<void> {
  I18nManager.allowRTL(isRtl);
  I18nManager.forceRTL(isRtl);
  await reloadAppAsync('direction changed');
}
