// planted: findings for every SDK line; a repo scan must never read this file
import { InteractionManager } from 'react-native';
import { Gesture, useTapGesture } from 'react-native-gesture-handler';
import { withInfoPlist } from 'expo/config-plugins';

export const config = { newArchEnabled: true, ios: { enableSceneSupport: true }, android: { targetSdkVersion: 30 } };
export const tap = Gesture.Tap();
export const hook = useTapGesture;
export const plugin = withInfoPlist;
InteractionManager.runAfterInteractions(() => undefined);
expect(jest.fn()).toBeCalled();
