// src/config/privacy-manifest.test.ts
import { PRIVACY_MANIFESTS } from './privacy-manifest';

function declared(category: string): readonly string[] {
  return (
    PRIVACY_MANIFESTS.NSPrivacyAccessedAPITypes.find(
      (api) => api.NSPrivacyAccessedAPIType === `NSPrivacyAccessedAPICategory${category}`,
    )?.NSPrivacyAccessedAPITypeReasons ?? []
  );
}

describe('PRIVACY_MANIFESTS', () => {
  it('declares every reason the pods of an Expo SDK 57 app declare', () => {
    // react-native: UserDefaults CA92.1, FileTimestamp C617.1, SystemBootTime 35F9.1;
    // expo-file-system: FileTimestamp 0A2A.1 and 3B52.1, DiskSpace E174.1 and 85F4.1.
    expect(declared('UserDefaults')).toStrictEqual(['CA92.1']);
    expect(declared('FileTimestamp')).toStrictEqual(['C617.1', '0A2A.1', '3B52.1']);
    expect(declared('SystemBootTime')).toStrictEqual(['35F9.1']);
    expect(declared('DiskSpace')).toStrictEqual(['E174.1', '85F4.1']);
  });

  it('declares no tracking and no tracking domains', () => {
    expect(PRIVACY_MANIFESTS.NSPrivacyTracking).toBe(false);
    expect(Object.keys(PRIVACY_MANIFESTS)).not.toContain('NSPrivacyTrackingDomains');
  });
});
