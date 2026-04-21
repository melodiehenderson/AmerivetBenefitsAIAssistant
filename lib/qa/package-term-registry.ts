// Apr 21 Step 3: centralized term registry for short definition-asks.
//
// Problem this solves: the engine historically only knew how to answer a
// narrow set of medical-flavored "what does X mean?" shapes (PPO, HMO,
// BCBSTX). A user anchored in a non-medical topic who asked "what's VSP?"
// or "what's Unum?" would hit a next-step menu instead of a direct answer.
//
// This registry centralizes the package-specific carrier and product terms
// so the engine can respond to a short-definition shape with a direct,
// topic-aware answer. When the active topic and the term agree, we lean
// into that topic. Otherwise we fall back to the term's canonical topic.
//
// Layered by design:
// 1. Engine detects "what's X?" shape via `isShortDefinitionAsk`.
// 2. Engine calls `lookupPackageTerm(term, session.currentTopic)` for a
//    topic-aware definition.
// 3. If the registry returns null, existing medical-definition fast-paths
//    still run (BCBSTX/PPO/HMO global definitions remain intact).

export type PackageTopic =
  | 'Medical'
  | 'Dental'
  | 'Vision'
  | 'Life Insurance'
  | 'Disability'
  | 'Critical Illness'
  | 'Accident/AD&D'
  | 'HSA/FSA';

type TermEntry = {
  // Lower-case surface forms that should match this term in user queries.
  // Matched via whole-word boundaries when practical.
  aliases: string[];
  // Ordered list of topic contexts this term can legitimately reference.
  // The first context is the canonical default when no active topic matches.
  topicContexts: PackageTopic[];
  // Produces the topic-aware definition for the given active topic. When
  // `activeTopic` is null/undefined or not in `topicContexts`, falls back
  // to the first entry in `topicContexts`.
  build: (activeTopic: PackageTopic | null) => string;
};

const TERMS: TermEntry[] = [
  {
    aliases: ['vsp', 'vsp vision plus', 'vsp vision', 'vision service plan'],
    topicContexts: ['Vision'],
    build: () => [
      `VSP stands for **Vision Service Plan**.`,
      ``,
      `In AmeriVet's package, VSP is the carrier behind the **VSP Vision Plus** plan — the vision coverage option.`,
      ``,
      `So when you see VSP in the plan list, that is AmeriVet's vision carrier.`,
    ].join('\n'),
  },
  {
    aliases: ['unum'],
    topicContexts: ['Life Insurance', 'Disability', 'Accident/AD&D', 'Critical Illness'],
    build: (activeTopic) => {
      const topic = activeTopic && (
        activeTopic === 'Life Insurance'
        || activeTopic === 'Disability'
        || activeTopic === 'Accident/AD&D'
        || activeTopic === 'Critical Illness'
      )
        ? activeTopic
        : 'Life Insurance';
      const contextLine =
        topic === 'Life Insurance'
          ? `In AmeriVet's package, Unum is the carrier behind the life insurance options (Basic Life & AD&D and Voluntary Term Life).`
          : topic === 'Disability'
            ? `In AmeriVet's package, Unum is the carrier behind the disability options (Short-Term and Long-Term Disability).`
            : topic === 'Accident/AD&D'
              ? `In AmeriVet's package, Unum is the carrier behind the Accident and AD&D coverage.`
              : `In AmeriVet's package, Unum is the carrier behind the Critical Illness coverage.`;
      return [
        `Unum is an insurance carrier.`,
        ``,
        contextLine,
        ``,
        `So when you see Unum in your benefits list, that is AmeriVet's supplemental protection carrier (life, disability, accident, and critical illness).`,
      ].join('\n');
    },
  },
  {
    aliases: ['bcbstx', 'blue cross blue shield of texas', 'blue cross blue shield'],
    topicContexts: ['Medical', 'Dental'],
    build: (activeTopic) => {
      if (activeTopic === 'Dental') {
        return [
          `BCBSTX stands for **Blue Cross Blue Shield of Texas**.`,
          ``,
          `In AmeriVet's package, BCBSTX is the carrier behind the **BCBSTX Dental PPO** — the dental coverage option.`,
          ``,
          `Note: BCBSTX is also the carrier behind AmeriVet's Standard HSA and Enhanced HSA medical plans, so you will see the BCBSTX name on both the dental and medical sides of the package.`,
        ].join('\n');
      }
      // Default / Medical context: preserve canonical medical answer.
      return [
        `BCBSTX stands for **Blue Cross Blue Shield of Texas**.`,
        ``,
        `In AmeriVet's package, BCBSTX is the carrier behind the Standard HSA and Enhanced HSA medical plans.`,
        ``,
        `So when you see BCBSTX in the plan list, that is the PPO carrier side of AmeriVet's medical package rather than the Kaiser option.`,
        `If you want, I can compare the BCBSTX plans against Kaiser next.`,
      ].join('\n');
    },
  },
  // Note: AD&D is intentionally NOT in this registry. The existing
  // `isNonMedicalDetailQuestion` detail handler already produces richer,
  // more topic-specific answers for "what does AD&D mean?" when the active
  // topic is Accident/AD&D or Life Insurance. Also, the alias "add" is a
  // common English word that would cause false positives via the bare-alias
  // fallback (e.g. "should I add critical illness?" → matched "add").
];

// Build a flattened alias -> entry map for fast lookup.
const ALIAS_TO_ENTRY: Map<string, TermEntry> = (() => {
  const map = new Map<string, TermEntry>();
  for (const entry of TERMS) {
    for (const alias of entry.aliases) {
      map.set(alias.toLowerCase(), entry);
    }
  }
  return map;
})();

/**
 * Returns the list of all aliases known to the registry, ordered longest-
 * first. Useful for building regex detectors.
 */
export function allRegistryAliases(): string[] {
  const aliases = Array.from(ALIAS_TO_ENTRY.keys());
  // Longest first so multi-word aliases match before shorter substrings.
  return aliases.sort((a, b) => b.length - a.length);
}

/**
 * Case-insensitive, short-ask-shape detector. Returns the alias matched
 * if the query is a short "what's X?" / "what is X?" / "what does X mean?"
 * against a registered term. Returns null otherwise.
 *
 * Rules of thumb:
 * - Only fires for short queries (< 10 tokens) that are shaped like a
 *   term-definition ask.
 * - Matches are whole-word or multi-word-whole-phrase.
 * - Does not fire for compound asks like "how does the Unum life policy
 *   compare to..." — those are left to existing topic routing.
 */
export function matchShortDefinitionAsk(query: string): { alias: string; entry: TermEntry } | null {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return null;

  // Shape: "what's X?", "what is X?", "what does X stand for?",
  // "what does X mean?", "define X", "tell me what X is", "X?"
  const shapeMatch = normalized.match(
    /^(?:(?:so\s+|well\s+|hmm\s+|ok(?:ay)?[\s,]+|alright[\s,]+)?(?:what\s+(?:does|is|are|'s|'re)|what's|whats|tell\s+me\s+what\s+(?:is|are)|define|can\s+you\s+define)\s+(?:an?\s+|the\s+)?)(.+?)(?:\s+(?:stand\s+for|mean|means|refer\s+to|refers\s+to|is|are|represent|represents))?\??\s*$/i,
  );

  // Also accept a bare alias or "X?" — common in fluid conversation.
  const bareCandidate = normalized.replace(/[?.!]+$/, '').trim();

  const candidate = shapeMatch ? shapeMatch[1].trim() : null;

  const tryLookup = (text: string): { alias: string; entry: TermEntry } | null => {
    const clean = text.replace(/[?.!]+$/, '').trim();
    const entry = ALIAS_TO_ENTRY.get(clean);
    if (entry) return { alias: clean, entry };
    // Try matching any registered alias inside the text as a whole word.
    for (const alias of allRegistryAliases()) {
      // Build a whole-word regex. Escape regex chars in alias.
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(^|\\s|/|\\()${escaped}($|\\s|\\?|\\.|!|\\))`, 'i');
      if (re.test(clean)) {
        const entryForAlias = ALIAS_TO_ENTRY.get(alias);
        if (entryForAlias) return { alias, entry: entryForAlias };
      }
    }
    return null;
  };

  if (candidate) {
    const hit = tryLookup(candidate);
    if (hit) return hit;
  }

  // Fall back to bare-alias / "X?" path — only for short queries to avoid
  // matching mid-sentence references.
  if (bareCandidate.split(/\s+/).length <= 5) {
    return tryLookup(bareCandidate);
  }

  return null;
}

/**
 * Topic-aware lookup. Returns a formatted definition for the given term
 * against the active topic. Null if the term is unknown.
 */
export function lookupPackageTerm(alias: string, activeTopic: PackageTopic | string | null | undefined): string | null {
  const entry = ALIAS_TO_ENTRY.get(alias.toLowerCase());
  if (!entry) return null;
  const topicAsPackage =
    activeTopic && (entry.topicContexts as readonly string[]).includes(activeTopic)
      ? (activeTopic as PackageTopic)
      : null;
  return entry.build(topicAsPackage);
}
