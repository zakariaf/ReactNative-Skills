// src/core/game/messages.ts
// Rules never return sentences: they return message keys in the game's namespace, and the app's
// i18n layer formats them in the user's language (i18n-strings-and-catalogs owns the catalogs).

/** A semantic catalog key; game keys start with the game id ('lights-out.lose.out-of-moves'). */
export type MessageId = string;

/** A message id plus its ICU placeholder values; the screen formats it with t(). */
export type Message = {
  readonly id: MessageId;
  readonly values: Readonly<Record<string, number | string>>;
};
