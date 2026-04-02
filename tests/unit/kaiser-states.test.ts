/**
 * Kaiser State Availability — Regression Suite
 *
 * Purpose: Guard against the "Kaiser only in California" bug.
 * Kaiser Permanente is available to AmeriVet employees in CA, GA, WA, and OR.
 * This test must run on every PR and deploy — it blocks Kaiser regression.
 */

import { describe, it, expect } from 'vitest';
import { getPlansByRegion } from '../../lib/data/amerivet';

const KAISER_STATES = ['CA', 'GA', 'WA', 'OR'];
const NON_KAISER_STATES = ['TX', 'FL', 'NY', 'IL'];

describe('Kaiser state availability — regression suite', () => {
  describe('Kaiser IS available in CA, GA, WA, and OR', () => {
    for (const state of KAISER_STATES) {
      it(`${state} user gets Kaiser plans`, () => {
        const plans = getPlansByRegion(state);
        const hasKaiser = plans.some(p => p.provider?.toLowerCase().includes('kaiser'));
        expect(hasKaiser).toBe(true);
      });
    }
  });

  describe('Kaiser is NOT available outside CA/GA/WA/OR', () => {
    for (const state of NON_KAISER_STATES) {
      it(`${state} user does NOT get Kaiser plans`, () => {
        const plans = getPlansByRegion(state);
        const hasKaiser = plans.some(p => p.provider?.toLowerCase().includes('kaiser'));
        expect(hasKaiser).toBe(false);
      });
    }
  });

  it('full state name "Washington" also returns Kaiser', () => {
    const plans = getPlansByRegion('Washington');
    expect(plans.some(p => p.provider?.toLowerCase().includes('kaiser'))).toBe(true);
  });

  it('full state name "Oregon" also returns Kaiser', () => {
    const plans = getPlansByRegion('Oregon');
    expect(plans.some(p => p.provider?.toLowerCase().includes('kaiser'))).toBe(true);
  });

  it('all non-Kaiser states still get BCBSTX medical plans', () => {
    for (const state of NON_KAISER_STATES) {
      const plans = getPlansByRegion(state);
      const hasBCBS = plans.some(p =>
        p.provider?.toLowerCase().includes('bcbs') && p.type === 'medical'
      );
      expect(hasBCBS).toBe(true);
    }
  });
});
