// __mocks__/@react-native-firebase/app-check.ts
// Root manual mock (automatic in every Jest project). The provider keeps what configure() received,
// so a test can assert the provider chosen for each platform and variant.
export class ReactNativeFirebaseAppCheckProvider {
  providerOptions: unknown = undefined;

  configure(options: unknown): void {
    this.providerOptions = options;
  }
}

export const initializeAppCheck = jest.fn(() => ({ type: 'app-check' }));
