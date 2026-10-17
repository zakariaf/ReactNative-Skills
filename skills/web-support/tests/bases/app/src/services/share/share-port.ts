// src/services/share/share-port.ts
export type ShareOutcome = 'shared' | 'dismissed' | 'unavailable';

export type SharePort = { readonly shareTask: (title: string, url: string) => Promise<ShareOutcome> };
