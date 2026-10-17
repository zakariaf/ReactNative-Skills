// Decoy: a planted import inside an installed skill; the repo scan must never count it.
import * as Haptics from 'expo-haptics';
import mobileAds from 'react-native-google-mobile-ads';

export const decoys = [Haptics, mobileAds];
