// src/services/error-net/install-error-net.ts
// Imported only for its side effect, as the first app import of the root layout (polyfills may come
// before it): `import '@/services/error-net/install-error-net';`. Imports run in order, so every app
// module evaluated after this line is covered by the net, including one that throws while loading.
import { appErrorNet } from './app-error-net';

appErrorNet.install();
