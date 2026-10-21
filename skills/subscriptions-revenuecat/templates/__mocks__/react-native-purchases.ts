// __mocks__/react-native-purchases.ts — root manual mock (automatic in every Jest project).
// react-native-purchases 10.13.0 needs its native module, which does not exist in Jest. Only the
// subscription adapter (src/services/subscription/) imports it. An adapter test reads these
// jest.fn()s through jest.requireMock('react-native-purchases').
function emptyCustomerInfo(): unknown {
  return { entitlements: { active: {}, all: {} }, managementURL: null };
}

const Purchases = {
  configure: jest.fn(),
  logIn: jest.fn(() => Promise.resolve({ customerInfo: emptyCustomerInfo(), created: false })),
  logOut: jest.fn(() => Promise.resolve(emptyCustomerInfo())),
  getOfferings: jest.fn(() => Promise.resolve({ all: {}, current: null })),
  purchasePackage: jest.fn(() => Promise.resolve({ customerInfo: emptyCustomerInfo() })),
  restorePurchases: jest.fn(() => Promise.resolve(emptyCustomerInfo())),
  getCustomerInfo: jest.fn(() => Promise.resolve(emptyCustomerInfo())),
  addCustomerInfoUpdateListener: jest.fn(),
  removeCustomerInfoUpdateListener: jest.fn(() => true),
};

export default Purchases;

// The real enums: plain JS without native code, so the mock can never drift from them.
export { PURCHASES_ERROR_CODE } from 'react-native-purchases/dist/errors';
export { PACKAGE_TYPE } from 'react-native-purchases/dist/offerings';
