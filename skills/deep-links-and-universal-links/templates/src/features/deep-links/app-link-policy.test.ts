// src/features/deep-links/app-link-policy.test.ts
// The policy comes from the embedded app config: the schemes prebuild registered and the hosts of
// ios.associatedDomains and android.intentFilters, so the gate accepts what the OS delivers.
import { appLinkPolicy } from './app-link-policy';
import { LINK_ROUTES } from './link-routes';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      ios: { associatedDomains: ['applinks:tasks.example.com'] },
      android: {
        intentFilters: [
          { autoVerify: true, data: [{ scheme: 'https', host: 'tasks.example.com' }] },
        ],
      },
    },
  },
}));
jest.mock('expo-linking', () => ({
  collectManifestSchemes: () => ['tasks-dev', 'com.example.tasks.dev'],
}));

describe('appLinkPolicy', () => {
  it('accepts the build schemes and verified hosts with the app allow-list', () => {
    expect(appLinkPolicy()).toStrictEqual({
      schemes: ['tasks-dev', 'com.example.tasks.dev'],
      hosts: ['tasks.example.com'],
      routes: LINK_ROUTES,
      isTestBuild: true,
    });
  });
});
