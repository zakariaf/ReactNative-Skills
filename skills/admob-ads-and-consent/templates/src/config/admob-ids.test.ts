// src/config/admob-ids.test.ts — the IDs keep AdMob's format on both platforms, and no ID is
// Google's sample (test builds pick the samples by themselves).
import { ADMOB_IDS } from './admob-ids.ts';

const APP_ID = /^ca-app-pub-\d{16}~\d{10}$/;
const UNIT_ID = /^ca-app-pub-\d{16}\/\d{10}$/;

describe('ADMOB_IDS', () => {
  it.each(['ios', 'android'] as const)('keeps the AdMob format for %s', (platform) => {
    const ids = ADMOB_IDS[platform];
    expect(ids.appId).toMatch(APP_ID);
    for (const unit of Object.values(ids.units)) expect(unit).toMatch(UNIT_ID);
  });

  it('holds no Google sample ID', () => {
    expect(JSON.stringify(ADMOB_IDS)).not.toContain('3940256099942544');
  });
});
