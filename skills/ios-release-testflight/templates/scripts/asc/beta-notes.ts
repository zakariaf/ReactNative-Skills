// scripts/asc/beta-notes.ts
// Sets TestFlight "What to Test" (whatsNew) for one build through the App Store Connect REST API:
// PATCH the existing en-US beta build localization, or POST one when none exists.
import { ascField, ascRequest, errorCodes } from './asc-client.ts';

import type { AscResponse } from './asc-client.ts';

export type BetaLocalization = { readonly id: string; readonly locale: string };

/** The locale of the tester notes (English: they are for testers, not an in-app string). */
export const WHATS_NEW_LOCALE = 'en-US';

export function localizationsPath(buildId: string): string {
  return `/v1/builds/${encodeURIComponent(buildId)}/betaBuildLocalizations`;
}

export function patchWhatsNewBody(localizationId: string, whatsNew: string): unknown {
  return {
    data: { type: 'betaBuildLocalizations', id: localizationId, attributes: { whatsNew } },
  };
}

export function createWhatsNewBody(buildId: string, whatsNew: string): unknown {
  return {
    data: {
      type: 'betaBuildLocalizations',
      attributes: { locale: WHATS_NEW_LOCALE, whatsNew },
      relationships: { build: { data: { type: 'builds', id: buildId } } },
    },
  };
}

/** The en-US localization in a GET .../betaBuildLocalizations answer, if there is one. */
export function findEnglishLocalization(json: unknown): BetaLocalization | null {
  const data = ascField(json, 'data');
  const items: unknown[] = Array.isArray(data) ? data : [];
  for (const item of items) {
    const id = ascField(item, 'id');
    const locale = ascField(ascField(item, 'attributes'), 'locale');
    if (typeof id === 'string' && locale === WHATS_NEW_LOCALE) {
      return { id, locale };
    }
  }
  return null;
}

function assertOk(response: AscResponse, what: string): void {
  if (!response.ok) {
    throw new Error(
      `${what}: App Store Connect answered ${String(response.status)} (${errorCodes(response)})`,
    );
  }
}

export async function setWhatsNew(token: string, buildId: string, whatsNew: string): Promise<void> {
  const list = await ascRequest(token, { method: 'GET', path: localizationsPath(buildId) });
  assertOk(list, 'reading beta build localizations');
  const english = list.ok ? findEnglishLocalization(list.json) : null;
  const response =
    english === null
      ? await ascRequest(token, {
          method: 'POST',
          path: '/v1/betaBuildLocalizations',
          body: createWhatsNewBody(buildId, whatsNew),
        })
      : await ascRequest(token, {
          method: 'PATCH',
          path: `/v1/betaBuildLocalizations/${encodeURIComponent(english.id)}`,
          body: patchWhatsNewBody(english.id, whatsNew),
        });
  assertOk(response, 'setting What to Test');
}
