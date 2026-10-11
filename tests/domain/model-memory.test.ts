import { describe, expect, test } from 'vitest';
import { modelMemory } from '../../src/lib/model-memory';

describe('existing model memory preferences', () => {
  test.each([
    ['5m', 'idle', 5, 'm'], ['30s', 'idle', 30, 's'], ['2h', 'idle', 2, 'h'],
    ['1h30m', 'idle', 90, 'm'], ['1.5m', 'idle', 90, 's'], ['300', 'idle', 5, 'm'],
    ['0', 'immediate', 5, 'm'], ['0s', 'immediate', 5, 'm'], ['-1', 'loaded', 5, 'm'],
    ['-5m', 'loaded', 5, 'm'], ['500ms', 'existing', 5, 'm'], ['invalid', 'existing', 5, 'm'],
  ])('preserves the meaning of %s', (value, mode, amount, unit) => {
    expect(modelMemory(value)).toEqual({ mode, amount, unit });
  });
});
