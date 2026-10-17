// src/track.ts (planted)
import analytics from '@react-native-firebase/analytics';

export const send = (email: string) => analytics().logEvent('signup', { email });
