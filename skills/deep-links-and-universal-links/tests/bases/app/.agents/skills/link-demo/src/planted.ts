// planted: an installed skill's fixture, never scanned
import { Linking } from 'react-native';
Linking.addEventListener('url', () => undefined);
void Linking.openURL(params.url);
