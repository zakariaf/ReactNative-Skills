// src/features/deep-links/link-origins.test.ts
import { linkOriginsFromConfig } from './link-origins';

describe('linkOriginsFromConfig', () => {
  it('reads the verified hosts of both platforms and the custom schemes', () => {
    const origins = linkOriginsFromConfig(
      {
        ios: {
          associatedDomains: [
            'applinks:tasks.example.com',
            'applinks:Share.Example.com?mode=developer',
            'webcredentials:tasks.example.com',
          ],
        },
        android: {
          intentFilters: [
            {
              autoVerify: true,
              data: [
                { scheme: 'https', host: 'tasks.example.com' },
                { scheme: 'http', host: 'www.tasks.example.com' },
              ],
            },
            { data: { scheme: 'https', host: 'unverified.example.com' } },
            { autoVerify: true, data: { scheme: 'tasks' } },
          ],
        },
      },
      ['Tasks', 'com.example.tasks', 'https'],
    );
    expect(origins).toStrictEqual({
      schemes: ['tasks', 'com.example.tasks'],
      hosts: ['tasks.example.com', 'share.example.com', 'www.tasks.example.com'],
    });
  });

  it('gives no hosts for a config without verified links', () => {
    expect(linkOriginsFromConfig(null, ['tasks'])).toStrictEqual({ schemes: ['tasks'], hosts: [] });
  });
});
