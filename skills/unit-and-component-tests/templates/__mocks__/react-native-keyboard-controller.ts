// __mocks__/react-native-keyboard-controller.ts — root manual mock (automatic in every Jest project).
// The package has no native module in Jest ("doesn't seem to be linked"), so every screen that wraps
// a form in its KeyboardAwareScrollView would crash. The package ships its own mock as untyped JS
// (views render as plain React Native views); this file hands it to Jest.
module.exports = jest.requireActual('react-native-keyboard-controller/jest');
