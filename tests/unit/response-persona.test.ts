import { describe, expect, it } from 'vitest';
import { detectPersona } from '../../lib/response-persona';

describe('response persona detection', () => {
  it('switches to analyzer for comparison questions', () => {
    const result = detectPersona('Compare the Standard and Enhanced HSA plans for me', ['We were talking about medical plan options'], 'GUIDE');
    expect(result.persona).toBe('ANALYZER');
    expect(result.switched).toBe(true);
  });

  it('switches to urgent for distressed time-sensitive questions', () => {
    const result = detectPersona('I am freaking out and need help now with disability', [], 'EXPLORER');
    expect(result.persona).toBe('URGENT');
    expect(result.switched).toBe(true);
  });

  it('keeps the prior persona when the new query is ambiguous', () => {
    const result = detectPersona('and what about that?', ['Tell me about maternity leave'], 'EXPLORER');
    expect(result.persona).toBe('EXPLORER');
    expect(result.switched).toBe(false);
  });
});