// planted: an installed skill's fixture uses browser globals and native-only APIs
import { ToastAndroid } from 'react-native';
window.addEventListener('load', () => ToastAndroid.show('x', 1));
