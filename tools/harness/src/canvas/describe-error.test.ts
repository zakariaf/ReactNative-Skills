// src/canvas/describe-error.test.ts
import { describeError } from './describe-error';

describe('describeError', () => {
  it('keeps the name and the message of an Error for the error log', () => {
    expect(describeError(new RangeError('frame 12 out of range'))).toBe(
      'RangeError: frame 12 out of range',
    );
  });

  it('turns anything else into text', () => {
    expect([describeError('lost context'), describeError(42)]).toStrictEqual([
      'lost context',
      '42',
    ]);
  });
});
