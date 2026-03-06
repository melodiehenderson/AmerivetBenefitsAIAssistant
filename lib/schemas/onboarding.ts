import { z } from 'zod';

// =============================================================================
// CITY-TO-STATE TRUTH TABLE (deterministic — never asks the LLM)
// =============================================================================
export const cityToStateMap: Record<string, string> = {
  // Major metros
  "new york": "NY", "los angeles": "CA", "chicago": "IL", "houston": "TX", "phoenix": "AZ",
  "philadelphia": "PA", "san antonio": "TX", "san diego": "CA", "dallas": "TX", "san jose": "CA",
  "austin": "TX", "jacksonville": "FL", "fort worth": "TX", "columbus": "OH", "charlotte": "NC",
  "san francisco": "CA", "indianapolis": "IN", "seattle": "WA", "denver": "CO", "washington": "DC",
  "boston": "MA", "el paso": "TX", "nashville": "TN", "detroit": "MI", "oklahoma city": "OK",
  "portland": "OR", "las vegas": "NV", "memphis": "TN", "louisville": "KY", "baltimore": "MD",
  "milwaukee": "WI", "albuquerque": "NM", "tucson": "AZ", "fresno": "CA", "sacramento": "CA",
  "kansas city": "MO", "long beach": "CA", "mesa": "AZ", "atlanta": "GA", "colorado springs": "CO",
  "virginia beach": "VA", "raleigh": "NC", "omaha": "NE", "miami": "FL", "oakland": "CA",
  "minneapolis": "MN", "tulsa": "OK", "wichita": "KS", "new orleans": "LA", "arlington": "TX",
  // Additional common cities
  "tampa": "FL", "orlando": "FL", "st. louis": "MO", "saint louis": "MO", "pittsburgh": "PA",
  "cincinnati": "OH", "cleveland": "OH", "riverside": "CA", "bakersfield": "CA", "aurora": "CO",
  "anaheim": "CA", "santa ana": "CA", "corpus christi": "TX", "lexington": "KY", "henderson": "NV",
  "stockton": "CA", "st paul": "MN", "saint paul": "MN", "anchorage": "AK", "newark": "NJ",
  "plano": "TX", "lubbock": "TX", "lincoln": "NE", "laredo": "TX", "jersey city": "NJ",
  "chandler": "AZ", "madison": "WI", "fort wayne": "IN", "durham": "NC", "st. petersburg": "FL",
};

// =============================================================================
// PASCAL-CASE SCHEMAS (authoritative — used by chat and onboarding routes)
// =============================================================================

/**
 * Represents all user-context slots collected during onboarding.
 * Fields are nullable so Zod can distinguish "not yet provided" from empty string.
 */
export const UserProfileSchema = z.object({
  name:   z.string().nullable().default(null),
  age:    z.number().int().min(18).max(120).nullable().default(null),
  city:   z.string().nullable().default(null),     // raw city provided by user
  state:  z.string().length(2).nullable().default(null), // resolved 2-letter code
});
export type UserProfile = z.infer<typeof UserProfileSchema>;

/**
 * Top-level session state that drives the state machine.
 * Steps are uppercase to distinguish from the legacy lowercase enum.
 */
export const SessionStateSchema = z.object({
  step: z.enum(['START', 'AWAITING_DEMOGRAPHICS', 'ACTIVE_CHAT']).default('START'),
  profile: UserProfileSchema,
  lastUpdated: z.string().default(() => new Date().toISOString()),
});
export type SessionState = z.infer<typeof SessionStateSchema>;

// =============================================================================
// LEGACY SCHEMAS (backward-compat for app/api/onboarding/route.ts)
// =============================================================================

/** @deprecated Use UserProfileSchema */
export const userProfileSchema = z.object({
  name:  z.string().min(1).optional(),
  age:   z.number().int().min(18).max(100).optional(),
  state: z.string().length(2).optional(),
});

/** @deprecated Use SessionStateSchema */
export const sessionStateSchema = z.object({
  sessionId:        z.string(),
  turn:             z.number().default(0),
  hasCollectedName: z.boolean().default(false),
  userName:         z.string().optional(),
  userAge:          z.number().optional(),
  userState:        z.string().optional(),
  lastBotMessage:   z.string().optional(),
  step:             z.enum(['start', 'awaiting_demographics', 'active_chat']).default('start'),
});

// Keep legacy type alias pointing to the new SessionState type
export type SessionState_Legacy = z.infer<typeof sessionStateSchema>;
