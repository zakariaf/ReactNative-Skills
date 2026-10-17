// src/features/settings/use-close-on-back.ts: Android's back button (and back gesture) closes an
// open sheet; the effect returns its cleanup.
import { useEffect, useEffectEvent } from 'react';
import { BackHandler } from 'react-native';

export function useCloseOnBack(isOpen: boolean, onClose: () => void): void {
  const handleClose = useEffectEvent(onClose);
  useEffect(() => {
    if (!isOpen) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      handleClose();
      return true;
    });
    return () => {
      subscription.remove();
    };
  }, [isOpen]);
}
