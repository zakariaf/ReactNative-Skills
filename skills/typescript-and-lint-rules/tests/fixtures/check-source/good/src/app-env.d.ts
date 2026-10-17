// src/app-env.d.ts: declaration merging needs interface and namespace, which *.d.ts files may use.
declare namespace NodeJS {
  interface ProcessEnv {
    readonly NODE_ENV?: 'development' | 'production' | 'test';
  }
}
declare const process: { readonly env: NodeJS.ProcessEnv };
