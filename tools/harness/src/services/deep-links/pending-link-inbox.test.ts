// src/services/deep-links/pending-link-inbox.test.ts
import { pendingLinks } from './pending-link-inbox';

const TASK_LINK = {
  gate: 'signed-in',
  target: { pathname: '/lists/[listId]', params: { listId: 'l-1' } },
};

describe('pendingLinks', () => {
  afterEach(() => {
    pendingLinks.clear();
  });

  it('hands the waiting link to its gate once', () => {
    pendingLinks.offer(TASK_LINK);
    expect(pendingLinks.take('signed-in')).toStrictEqual(TASK_LINK.target);
    expect(pendingLinks.take('signed-in')).toBeNull();
  });

  it('keeps the link from a screen behind another gate', () => {
    pendingLinks.offer(TASK_LINK);
    expect(pendingLinks.take('onboarded')).toBeNull();
    expect(pendingLinks.take('signed-in')).toStrictEqual(TASK_LINK.target);
  });

  it('keeps only the newest link', () => {
    pendingLinks.offer(TASK_LINK);
    pendingLinks.offer({ gate: 'signed-in', target: { pathname: '/', params: {} } });
    expect(pendingLinks.take('signed-in')).toStrictEqual({ pathname: '/', params: {} });
  });

  it('drops the link on clear', () => {
    pendingLinks.offer(TASK_LINK);
    pendingLinks.clear();
    expect(pendingLinks.take('signed-in')).toBeNull();
  });
});
