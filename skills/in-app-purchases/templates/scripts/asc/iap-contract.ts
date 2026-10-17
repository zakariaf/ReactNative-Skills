// scripts/asc/iap-contract.ts: reads contracts/in-app-purchases.json, the developer's product decisions.
export type StoreText = {
  readonly locale: string;
  readonly name: string;
  readonly description: string;
};

/** The facts the App Store Connect script needs; the checker holds the rest of the file. */
export type IapContract = {
  readonly productId: string;
  readonly familyShareable: boolean;
  readonly price: {
    readonly amount: string;
    readonly currency: string;
    readonly baseTerritory: string;
  };
  readonly storeTexts: readonly StoreText[];
  readonly reviewNote: string;
};

/** naming-conventions' product-id grammar (valid on both stores): [a-z0-9][a-z0-9._], at most 40. */
export const PRODUCT_ID = /^[a-z0-9][a-z0-9._]{0,39}$/u;
const AMOUNT = /^\d+(?:\.\d{1,2})?$/u;
const TERRITORY = /^[A-Z]{3}$/u;
const NAME_MAX = 30;
const DESCRIPTION_MAX = 45;

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
}

function text(value: unknown, key: string): string {
  const found = field(value, key);
  if (typeof found !== 'string' || found === '') throw new Error(`contract: "${key}" is missing`);
  return found;
}

function storeTextOf(value: unknown): StoreText {
  const name = text(value, 'name');
  const description = text(value, 'description');
  if (name.length < 2 || name.length > NAME_MAX || description.length > DESCRIPTION_MAX) {
    throw new Error('contract: a store text breaks the limits (name 2-30, description 45)');
  }
  return { locale: text(value, 'locale'), name, description };
}

/** Validates the parsed JSON; throws with the first problem. */
export function parseIapContract(json: unknown): IapContract {
  const productId = text(json, 'productId');
  if (!PRODUCT_ID.test(productId))
    throw new Error(`contract: productId "${productId}" breaks the id rules`);
  const familyShareable = field(json, 'familyShareable');
  if (typeof familyShareable !== 'boolean')
    throw new Error('contract: "familyShareable" is missing');
  const priceJson = field(json, 'price');
  const price = {
    amount: text(priceJson, 'amount'),
    currency: text(priceJson, 'currency'),
    baseTerritory: text(priceJson, 'baseTerritory'),
  };
  if (!AMOUNT.test(price.amount) || !TERRITORY.test(price.baseTerritory)) {
    throw new Error('contract: "price" needs a decimal amount and a three-letter territory');
  }
  const texts = field(json, 'storeTexts');
  if (!Array.isArray(texts) || texts.length === 0)
    throw new Error('contract: "storeTexts" is empty');
  const reviewNote = field(json, 'reviewNote');
  return {
    productId,
    familyShareable,
    price,
    storeTexts: texts.map(storeTextOf),
    reviewNote: typeof reviewNote === 'string' ? reviewNote : '',
  };
}
