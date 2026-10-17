// modules/task-checksum/src/NativeTaskChecksum.ts
// The codegen spec: codegen reads this interface and generates the Objective-C++ protocol and the
// Java base class the native classes implement, so the compiler checks the contract on both sides.
// get (not getEnforcing): a binary without the module yields null instead of a crash at import.
import { TurboModuleRegistry } from 'react-native';

import type { TurboModule } from 'react-native';

export interface Spec extends TurboModule {
  /** FNV-1a 64-bit checksum of the text's UTF-8 bytes, as 16 lowercase hex digits. */
  checksum(text: string): string;
}

export default TurboModuleRegistry.get<Spec>('NativeTaskChecksum');
