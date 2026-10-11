import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { assertFocusCapacity, transitionTask, wouldCreateCycle } from '../../src/lib/domain/rules';
import { captureResponse } from '../../src/lib/server/ai';

describe('domain rules',()=>{
  test('focus boundary is three',()=>{expect(()=>assertFocusCapacity(2)).not.toThrow();expect(()=>assertFocusCapacity(3)).toThrow(/three/);});
  test('invalid terminal transitions fail',()=>{expect(()=>transitionTask('dropped','completed')).toThrow();expect(transitionTask('open','waiting')).toBe('waiting');});
  test('cycle detection follows transitive edges',()=>{expect(wouldCreateCycle([[1,2],[2,3]],3,1)).toBe(true);expect(wouldCreateCycle([[1,2]],3,2)).toBe(false);expect(wouldCreateCycle([],1,1)).toBe(true);});
  test('stored AI capture fixture satisfies the versioned contract',()=>{const fixture=JSON.parse(readFileSync('tests/fixtures/ai/capture-rant.json','utf8'));expect(captureResponse.parse(fixture).proposals).toHaveLength(2);});
});
