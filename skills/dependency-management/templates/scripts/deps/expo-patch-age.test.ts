// scripts/deps/expo-patch-age.test.ts
import {
  dueDay,
  isPatchMove,
  judgeMismatches,
  parseDoctor,
  parseInstallCheck,
  parsePublishTimes,
  youngPatchWarnings,
  type AgeRule,
  type PublishTimes,
} from './expo-patch-age.ts';

// Real output of 2026-09-29, the day expo 57.0.26 and expo-constants 57.0.20 were published.
const INSTALL_CHECK = [
  'The following packages should be updated for best compatibility with the installed expo version:',
  '  expo@57.0.25 - expected version: ~57.0.26',
  '  expo-constants@57.0.19 - expected version: ~57.0.20',
  'Your project may not work correctly until you install the expected versions of the packages.',
  'Found outdated dependencies',
].join('\n');

const DOCTOR = [
  'Running 21 checks on your project...',
  '20/21 checks passed. 1 checks failed. Possible issues detected:',
  '✖ Check that packages match versions required by installed Expo SDK',
  '',
  '🔧 Patch version mismatches',
  'package  expected  found    ',
  'expo     ~57.0.26  57.0.25  ',
  '',
  '1 package out of date.',
].join('\n');

const TIMES: Readonly<Record<string, string>> = {
  'expo@57.0.26': '2026-09-29T10:57:08.644Z',
  'expo-constants@57.0.20': '2026-09-29T10:56:40.000Z',
  'expo@57.0.21': '2026-09-08T13:50:37.144Z',
};
const publishedAt: PublishTimes = (name, version) => TIMES[`${name}@${version}`] ?? null;
const at = (todayIso: string, releaseAgeDays = 7): AgeRule => ({ todayIso, releaseAgeDays });

describe('parseInstallCheck', () => {
  it('reads every package line with its found and lowest expected version', () => {
    expect(parseInstallCheck(INSTALL_CHECK)).toStrictEqual([
      { name: 'expo', found: '57.0.25', expected: '57.0.26', expectedSpec: '~57.0.26' },
      {
        name: 'expo-constants',
        found: '57.0.19',
        expected: '57.0.20',
        expectedSpec: '~57.0.20',
      },
    ]);
  });

  it('reads scoped package names and keeps an exact expected specifier exact', () => {
    const line = '  @shopify/react-native-skia@2.6.2 - expected version: 2.6.3';
    expect(parseInstallCheck(line)).toStrictEqual([
      {
        name: '@shopify/react-native-skia',
        found: '2.6.2',
        expected: '2.6.3',
        expectedSpec: '2.6.3',
      },
    ]);
  });
});

describe('parseDoctor', () => {
  it('reads the version table when the version check is the only failed check', () => {
    expect(parseDoctor(DOCTOR)).toStrictEqual([
      { name: 'expo', expected: '57.0.26', expectedSpec: '~57.0.26', found: '57.0.25' },
    ]);
  });

  it('returns null when another check failed too', () => {
    const output = `${DOCTOR}\n✖ Check that no duplicate dependencies are installed\n`;
    expect(parseDoctor(output)).toBeNull();
  });

  it('returns null when no check is marked as failed', () => {
    expect(parseDoctor('Running 21 checks on your project...\n')).toBeNull();
  });
});

describe('isPatchMove', () => {
  it('accepts a later patch on the same line and rejects minor and major moves', () => {
    expect(isPatchMove('57.0.25', '57.0.26')).toBe(true);
    expect(isPatchMove('4.26.2', '4.27.0')).toBe(false);
    expect(isPatchMove('57.0.25', '58.0.0')).toBe(false);
    expect(isPatchMove('57.0.26', '57.0.25')).toBe(false);
  });
});

describe('dueDay', () => {
  it('returns the first whole UTC day at least seven days after publishing', () => {
    expect(dueDay('2026-09-29T10:57:08.644Z')).toBe('2026-10-07');
    expect(dueDay('2026-09-29T00:00:00.000Z')).toBe('2026-10-06');
  });

  it('honours a stricter release age', () => {
    expect(dueDay('2026-09-29T10:57:08.644Z', 14)).toBe('2026-10-14');
  });
});

describe('judgeMismatches', () => {
  it('turns a patch published today into a warning with its due date', () => {
    const verdict = judgeMismatches(
      parseInstallCheck(INSTALL_CHECK),
      publishedAt,
      at('2026-09-29'),
    );
    expect(verdict).toStrictEqual({
      kind: 'young-patches',
      patches: [
        {
          name: 'expo',
          found: '57.0.25',
          expected: '57.0.26',
          expectedSpec: '~57.0.26',
          publishedIso: '2026-09-29T10:57:08.644Z',
          dueIso: '2026-10-07',
        },
        {
          name: 'expo-constants',
          found: '57.0.19',
          expected: '57.0.20',
          expectedSpec: '~57.0.20',
          publishedIso: '2026-09-29T10:56:40.000Z',
          dueIso: '2026-10-07',
        },
      ],
    });
  });

  it('keeps a patch a warning longer under a stricter release age', () => {
    const verdict = judgeMismatches(parseDoctor(DOCTOR), publishedAt, at('2026-10-07', 14));
    expect(verdict.kind === 'young-patches' ? verdict.patches[0]?.dueIso : null).toBe('2026-10-14');
  });

  it('fails the same patch from its due date on', () => {
    expect(judgeMismatches(parseDoctor(DOCTOR), publishedAt, at('2026-10-07'))).toStrictEqual({
      kind: 'due',
    });
  });

  it('fails an old patch at once', () => {
    const old = [{ name: 'expo', found: '57.0.20', expected: '57.0.21', expectedSpec: '~57.0.21' }];
    expect(judgeMismatches(old, publishedAt, at('2026-09-29'))).toStrictEqual({ kind: 'due' });
  });

  it('fails a minor move, an unknown publish time and a failure without a version table', () => {
    const minor = [
      { name: 'expo-constants', found: '57.0.20', expected: '57.1.0', expectedSpec: '~57.1.0' },
    ];
    const unknown = [
      { name: 'expo-font', found: '57.0.4', expected: '57.0.5', expectedSpec: '~57.0.5' },
    ];
    expect(judgeMismatches(minor, publishedAt, at('2026-09-29'))).toStrictEqual({ kind: 'due' });
    expect(judgeMismatches(unknown, publishedAt, at('2026-09-29'))).toStrictEqual({ kind: 'due' });
    expect(judgeMismatches(null, publishedAt, at('2026-09-29'))).toStrictEqual({ kind: 'due' });
    expect(judgeMismatches([], publishedAt, at('2026-09-29'))).toStrictEqual({ kind: 'due' });
  });
});

describe('youngPatchWarnings', () => {
  it('names the package, the publish day and the due date', () => {
    const verdict = judgeMismatches(parseDoctor(DOCTOR), publishedAt, at('2026-09-30'));
    const patches = verdict.kind === 'young-patches' ? verdict.patches : [];
    expect(youngPatchWarnings('expo-doctor', patches)).toStrictEqual([
      'WARN expo-doctor: expo 57.0.26 (found 57.0.25) was published 2026-09-29; ' +
        'min-release-age=7 refuses it until 2026-10-07, so this mismatch is a warning until then ' +
        'and fails from 2026-10-07 on (then run npx expo install expo@~57.0.26 in every Expo app and ' +
        'move its row in the dependency policy and any root override in the same commit)',
    ]);
  });

  it('keeps the exact specifier Expo prints for a package it pins exactly', () => {
    const output = '  react-native-worklets@0.10.1 - expected version: 0.10.2';
    const times: PublishTimes = () => '2026-09-30T08:00:00.000Z';
    const verdict = judgeMismatches(parseInstallCheck(output), times, at('2026-10-01'));
    const patches = verdict.kind === 'young-patches' ? verdict.patches : [];
    expect(youngPatchWarnings('expo install --check', patches)[0]).toContain(
      'then run npx expo install react-native-worklets@0.10.2 in every Expo app',
    );
  });

  it('pins a dev tool exactly with npm install -D, under the stricter release age', () => {
    const output = '  jest-expo@57.0.5 - expected version: ~57.0.6';
    const times: PublishTimes = () => '2026-09-30T08:00:00.000Z';
    const verdict = judgeMismatches(parseInstallCheck(output), times, at('2026-10-01', 14));
    const patches = verdict.kind === 'young-patches' ? verdict.patches : [];
    const isDevTool = (name: string): boolean => name === 'jest-expo';
    const [warning] = youngPatchWarnings('expo install --check', patches, {
      releaseAgeDays: 14,
      isDevTool,
    });
    expect(warning).toContain('min-release-age=14 refuses it until 2026-10-15');
    expect(warning).toContain('then run npm install -D jest-expo@57.0.6 and move its row');
  });
});

describe('parsePublishTimes', () => {
  it('reads the version times of npm view <name> time --json', () => {
    expect(parsePublishTimes('{"57.0.26":"2026-09-29T10:00:00.000Z"}')).toStrictEqual({
      '57.0.26': '2026-09-29T10:00:00.000Z',
    });
  });

  it('returns no times for output that is not a JSON object, never throwing', () => {
    expect(parsePublishTimes('npm notice New minor version of npm available!')).toStrictEqual({});
    expect(parsePublishTimes('["57.0.26"]')).toStrictEqual({});
  });
});
