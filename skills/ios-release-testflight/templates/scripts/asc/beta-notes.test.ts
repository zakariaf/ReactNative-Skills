// scripts/asc/beta-notes.test.ts
import {
  createWhatsNewBody,
  findEnglishLocalization,
  localizationsPath,
  patchWhatsNewBody,
} from './beta-notes.ts';

describe('beta notes payloads', () => {
  it('addresses the build and patches whatsNew', () => {
    expect(localizationsPath('b-1')).toBe('/v1/builds/b-1/betaBuildLocalizations');
    // App Store Connect resource type names are camelCase, so the body is compared as JSON text.
    expect(JSON.stringify(patchWhatsNewBody('loc-1', 'text'))).toBe(
      '{"data":{"type":"betaBuildLocalizations","id":"loc-1","attributes":{"whatsNew":"text"}}}',
    );
  });

  it('creates an en-US localization related to the build when none exists', () => {
    expect(JSON.stringify(createWhatsNewBody('b-1', 'text'))).toContain(
      '"attributes":{"locale":"en-US","whatsNew":"text"},"relationships":{"build":{"data":{"type":"builds","id":"b-1"}}}',
    );
  });

  it('finds the en-US localization, and nothing in an empty answer', () => {
    const json = {
      data: [
        { id: 'de', attributes: { locale: 'de-DE' } },
        { id: 'en', attributes: { locale: 'en-US' } },
      ],
    };
    expect(findEnglishLocalization(json)).toStrictEqual({ id: 'en', locale: 'en-US' });
    expect(findEnglishLocalization({ data: [] })).toBeNull();
    expect(findEnglishLocalization(null)).toBeNull();
  });
});
