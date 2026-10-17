// src/stores/premium/upsell-line.ts: the optional in-context upsell line, capped at once a day and never shown to an owner.

export type UpsellInput = {
  readonly isPremium: boolean;
  /** The store's price text the paywall flow carries (priceOf), or null while none is known. */
  readonly priceText: string | null;
  /** The local day ('YYYY-MM-DD' from clock.today()) the line last showed, or null if never. */
  readonly lastShownOn: string | null;
  /** clock.today(): the local day now. */
  readonly today: string;
};

/**
 * The price text for one quiet upsell line beside a feature (under a finished list, in a locked
 * row), or null for no line: never for an owner, never without the store's price (a typed price is
 * never shown), and at most once per local day. The caller saves `today` as lastShownOn when the
 * line shows. It is a line, never a pop-up, and never follows a failed or cancelled purchase.
 */
export function upsellPrice(input: UpsellInput): string | null {
  if (input.isPremium || input.priceText === null) return null;
  return input.lastShownOn === input.today ? null : input.priceText;
}
