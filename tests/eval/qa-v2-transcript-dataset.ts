export type QaV2TranscriptTurn = {
  user: string;
  mustContain?: string[];
  mustNotContain?: string[];
};

export type QaV2TranscriptCase = {
  id: string;
  category: string;
  initialSession: Record<string, unknown>;
  turns: QaV2TranscriptTurn[];
};

export const qaV2TranscriptDataset: QaV2TranscriptCase[] = [
  {
    id: 'V2-TX-001',
    category: 'medical_compare_followup',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 45,
      userState: 'GA',
      dataConfirmed: true,
      currentTopic: 'Medical',
    },
    turns: [
      {
        user: 'which medical plan should i pick if i have a spouse and 2 kids and we are generally healthy and want the lowest bills?',
        mustContain: ['Recommendation for Employee + Family coverage', 'My recommendation: Standard HSA'],
      },
      {
        user: 'yes, please compare',
        mustContain: ['Projected Healthcare Costs for Employee + Family coverage'],
        mustNotContain: ['Employee Only coverage', 'like a benefits counselor'],
      },
    ],
  },
  {
    id: 'V2-TX-002',
    category: 'benefit_decision_guidance',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 45,
      userState: 'GA',
      dataConfirmed: true,
    },
    turns: [
      {
        user: 'please help me think through which one of these benefits is worth considering for my situation.',
        mustContain: ['what is actually worth attention first', 'Medical first', 'family income'],
        mustNotContain: ['Here are the benefits available to you as an AmeriVet employee', 'like a benefits counselor'],
      },
    ],
  },
  {
    id: 'V2-TX-003',
    category: 'hsa_followup_explanations',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 45,
      userState: 'GA',
      dataConfirmed: true,
    },
    turns: [
      {
        user: 'can you tell me about hsa/fsa?',
        mustContain: ['Health Savings Account', 'Flexible Spending Account'],
      },
      {
        user: 'what does hsa mean?',
        mustContain: ['HSA stands for **Health Savings Account**'],
        mustNotContain: ['HSA/FSA overview'],
      },
    ],
  },
  {
    id: 'V2-TX-004',
    category: 'supplemental_explanation',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 45,
      userState: 'GA',
      dataConfirmed: true,
    },
    turns: [
      {
        user: 'what is accident/ad&d?',
        mustContain: ['Accident/AD&D coverage is another supplemental option'],
        mustNotContain: ['I don’t have enough information'],
      },
    ],
  },
  {
    id: 'V2-TX-005',
    category: 'dental_followup_and_pivot',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 45,
      userState: 'GA',
      dataConfirmed: true,
    },
    turns: [
      {
        user: 'dental please',
        mustContain: ['Dental coverage: **BCBSTX Dental PPO**'],
      },
      {
        user: "what's an orthodontia rider?",
        mustContain: ['orthodontia rider means', 'braces'],
        mustNotContain: ['like a benefits counselor'],
      },
      {
        user: 'yes - show me what i can get for vision',
        mustContain: ['Vision coverage: **VSP Vision Plus**'],
      },
    ],
  },
  {
    id: 'V2-TX-006',
    category: 'state_parser_guard',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 45,
      userState: 'GA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Family',
    },
    turns: [
      {
        user: 'what are all the benefits i have access to?',
        mustContain: ['45 in GA'],
        mustNotContain: ['45 in ME', '45 in IN'],
      },
      {
        user: 'Help me calculate healthcare costs for next year. My household is family4+, usage level is high, and I prefer kaiser network. Please recommend plans and estimate costs.',
        mustContain: ['Employee + Family coverage', 'Georgia'],
        mustNotContain: ['Maine', 'Indiana'],
      },
      {
        user: "i'm in GA",
        mustContain: ['I have you in GA'],
        mustNotContain: ['Perfect! 45 in IN', 'Perfect! 45 in ME', 'benefits available to you'],
      },
    ],
  },
  {
    id: 'V2-TX-007',
    category: 'chatty_life_pivot',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 45,
      userState: 'GA',
      dataConfirmed: true,
      currentTopic: 'Vision',
      completedTopics: ['Dental', 'Vision'],
    },
    turns: [
      {
        user: 'oh! okay - yeah - life insurance info',
        mustContain: ['Life insurance options'],
        mustNotContain: ['I don’t have enough information'],
      },
      {
        user: "actually, i'm in FL",
        mustContain: ['updated your state to FL'],
      },
    ],
  },
  {
    id: 'V2-TX-008',
    category: 'topic_before_demographics',
    initialSession: {
      step: 'start',
      context: {},
      userName: 'Sarah',
      hasCollectedName: true,
    },
    turns: [
      {
        user: 'medical please',
        mustContain: ['age and state'],
      },
      {
        user: '35, FL',
        mustContain: ['35 in FL', 'benefits available to you'],
      },
    ],
  },
  {
    id: 'V2-TX-009',
    category: 'package_guidance_after_topic_pivots',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 45,
      userState: 'GA',
      dataConfirmed: true,
    },
    turns: [
      {
        user: 'dental please',
        mustContain: ['Dental coverage: **BCBSTX Dental PPO**'],
      },
      {
        user: 'yes - show me what i can get for vision',
        mustContain: ['Vision coverage: **VSP Vision Plus**'],
      },
      {
        user: 'what else should i consider?',
        mustContain: ['life, disability, or supplemental protection'],
        mustNotContain: ['Here are the benefits available to you as an AmeriVet employee'],
      },
    ],
  },
  {
    id: 'V2-TX-010',
    category: 'state_update_without_explicit_correction_phrase',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 45,
      userState: 'FL',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Family',
    },
    turns: [
      {
        user: "i'm in GA",
        mustContain: ['updated your state to GA', 'refreshed medical view'],
        mustNotContain: ['Perfect! 45 in GA', 'benefits available to you'],
      },
    ],
  },
  {
    id: 'V2-TX-011',
    category: 'family_protection_guidance_followup',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      coverageTierLock: 'Employee + Family',
    },
    turns: [
      {
        user: "what benefit should i pay attention to first if i'm mostly worried about protecting my family?",
        mustContain: ['protecting your family', 'life insurance next', 'disability'],
        mustNotContain: ['Tell me which area you want to focus on next'],
      },
      {
        user: 'routine care',
        mustContain: ['If routine care is what matters most', 'dental next', 'vision after that'],
        mustNotContain: ['Tell me which area you want to focus on next'],
      },
    ],
  },
  {
    id: 'V2-TX-012',
    category: 'orthodontia_braces_followup',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      currentTopic: 'Dental',
      completedTopics: ['Dental'],
    },
    turns: [
      {
        user: "what's an orthodontia rider?",
        mustContain: ['orthodontia rider means', 'braces'],
      },
      {
        user: 'yes please - show me what that means for braces',
        mustContain: ['For braces, the practical question', 'orthodontia copay is $500'],
        mustNotContain: ['Tell me which area you want to focus on next'],
      },
    ],
  },
  {
    id: 'V2-TX-013',
    category: 'demographic_parser_or_not_in',
    initialSession: {
      step: 'start',
      context: {},
      userName: 'Rhonda',
      hasCollectedName: true,
    },
    turns: [
      {
        user: 'tell me about my medical options please',
        mustContain: ['age and state'],
      },
      {
        user: "ok - i'm 42 in OR",
        mustContain: ['42 in OR', 'benefits available to you'],
        mustNotContain: ['42 in IN'],
      },
    ],
  },
  {
    id: 'V2-TX-014',
    category: 'state_correction_cost_flow',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Family',
    },
    turns: [
      {
        user: 'I actually live in OR. Help me calculate healthcare costs for next year. My household is family4+, usage level is high, and I prefer kaiser network. Please recommend plans and estimate costs.',
        mustContain: ['updated cost view', 'Projected Healthcare Costs for Employee + Family coverage in Oregon'],
        mustNotContain: ['updated medical view', 'Want to compare plans or switch coverage tiers?'],
      },
    ],
  },
  {
    id: 'V2-TX-015',
    category: 'hsa_fit_followup',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      currentTopic: 'HSA/FSA',
    },
    turns: [
      {
        user: 'can you tell me about hsa/fsa?',
        mustContain: ['Health Savings Account', 'Flexible Spending Account'],
      },
      {
        user: 'yes, tell me when an hsa is the better fit',
        mustContain: ['simplest way to think about HSA versus FSA fit', 'rollover year to year', 'cannot make full HSA contributions'],
        mustNotContain: ['Tell me which area you want to focus on next'],
      },
    ],
  },
  {
    id: 'V2-TX-016',
    category: 'supplemental_fit_followup',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      currentTopic: 'Accident/AD&D',
    },
    turns: [
      {
        user: 'what is accident/ad&d?',
        mustContain: ['Accident/AD&D coverage is another supplemental option'],
      },
      {
        user: 'yes, help me think through whether that is worth considering',
        mustContain: ['usually worth considering', 'active and you want another layer', 'medical plan'],
        mustNotContain: ['Tell me which area you want to focus on next'],
      },
    ],
  },
  {
    id: 'V2-TX-017',
    category: 'supplemental_compare_followup',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      currentTopic: 'Accident/AD&D',
    },
    turns: [
      {
        user: 'what is accident/ad&d?',
        mustContain: ['Accident/AD&D coverage is another supplemental option'],
      },
      {
        user: 'yes, help me think through whether that is worth considering',
        mustContain: ['usually worth considering'],
      },
      {
        user: "yes, i'd like that",
        mustContain: ['plain-language difference between Accident/AD&D and Critical Illness', 'injury-related events', 'serious diagnosis'],
        mustNotContain: ['Tell me which area you want to focus on next'],
      },
    ],
  },
  {
    id: 'V2-TX-018',
    category: 'family_protection_compare_followup',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      coverageTierLock: 'Employee + Family',
    },
    turns: [
      {
        user: "what benefit should i pay attention to first if i'm mostly worried about protecting my family?",
        mustContain: ['protecting your family'],
      },
      {
        user: "yes, i'd like that",
        mustContain: ['simplest way to separate life insurance from disability', 'protecting part of your income', 'if you die'],
        mustNotContain: ['Tell me which area you want to focus on next'],
      },
    ],
  },
  {
    id: 'V2-TX-019',
    category: 'routine_care_compare_followup',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      coverageTierLock: 'Employee + Family',
    },
    turns: [
      {
        user: "what benefit should i pay attention to first if i'm mostly worried about protecting my family?",
        mustContain: ['protecting your family'],
      },
      {
        user: 'routine care',
        mustContain: ['If routine care is what matters most'],
      },
      {
        user: 'yes, do that',
        mustContain: ['deciding between dental and vision as the next add-on', 'Choose dental first', 'Choose vision first'],
        mustNotContain: ['Tell me which area you want to focus on next'],
      },
    ],
  },
  {
    id: 'V2-TX-020',
    category: 'medical_recommendation_why_followup',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 45,
      userState: 'OR',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Family',
    },
    turns: [
      {
        user: 'which medical plan should i pick if i have a spouse and 2 kids and we are generally healthy and want the lowest bills?',
        mustContain: ['My recommendation: Standard HSA'],
      },
      {
        user: 'why?',
        mustContain: ['The reason I leaned Standard HSA', 'keeps more of the savings in your paycheck'],
        mustNotContain: ['Tell me which area you want to focus on next'],
      },
      {
        user: 'is enhanced worth the extra premium?',
        mustContain: ['Whether the richer medical option is worth the extra premium', 'If usage is low, I would usually keep the cheaper option'],
        mustNotContain: ['Tell me which area you want to focus on next'],
      },
    ],
  },
  {
    id: 'V2-TX-021',
    category: 'comparison_practical_take_followup',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      currentTopic: 'Accident/AD&D',
    },
    turns: [
      {
        user: 'what is accident/ad&d?',
        mustContain: ['Accident/AD&D coverage is another supplemental option'],
      },
      {
        user: 'yes, help me think through whether that is worth considering',
        mustContain: ['usually worth considering'],
      },
      {
        user: "yes, i'd like that",
        mustContain: ['plain-language difference between Accident/AD&D and Critical Illness'],
      },
      {
        user: 'which one would you pick?',
        mustContain: ['My practical take is that I would usually choose Accident/AD&D', 'Critical Illness first'],
        mustNotContain: ['Tell me which area you want to focus on next'],
      },
    ],
  },
  {
    id: 'V2-TX-022',
    category: 'bare_do_that_topic_continuity',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
    },
    turns: [
      {
        user: 'dental please',
        mustContain: ['Dental coverage: **BCBSTX Dental PPO**'],
      },
      {
        user: "ok let's do that",
        mustContain: ['Vision coverage: **VSP Vision Plus**'],
        mustNotContain: ['Tell me which area you want to focus on next'],
      },
    ],
  },
  {
    id: 'V2-TX-023',
    category: 'bare_do_that_medical_tradeoff',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'CA',
      dataConfirmed: true,
      coverageTierLock: 'Employee + Family',
      messages: [
        { role: 'user', content: 'My household is family4+, usage level is high, and I prefer kaiser network.' },
      ],
    },
    turns: [
      {
        user: 'healthcare costs',
        mustContain: ['If keeping healthcare costs down is the priority'],
      },
      {
        user: 'yes, do that',
        mustContain: ['Projected Healthcare Costs for Employee + Family coverage'],
        mustNotContain: ['Tell me which area you want to focus on next'],
      },
    ],
  },
  {
    id: 'V2-TX-024',
    category: 'medical_family_specific_followup',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'OR',
      dataConfirmed: true,
      coverageTierLock: 'Employee + Family',
      currentTopic: 'Medical',
    },
    turns: [
      {
        user: 'which medical plan should i pick if i have a spouse and 2 kids and we are generally healthy and want the lowest bills?',
        mustContain: ['My recommendation: Standard HSA'],
      },
      {
        user: 'what about for my kids?',
        mustContain: ['thinking specifically about your kids', 'If your kids are generally healthy'],
        mustNotContain: ['Tell me which area you want to focus on next'],
      },
    ],
  },
  {
    id: 'V2-TX-025',
    category: 'affirmative_after_comparison_narrows_decision',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      currentTopic: 'Accident/AD&D',
    },
    turns: [
      {
        user: 'what is accident/ad&d?',
        mustContain: ['Accident/AD&D coverage is another supplemental option'],
      },
      {
        user: 'yes, help me think through whether that is worth considering',
        mustContain: ['usually worth considering'],
      },
      {
        user: "yes, i'd like that",
        mustContain: ['plain-language difference between Accident/AD&D and Critical Illness'],
      },
      {
        user: "yes, i'd like that",
        mustContain: ['My practical take is that I would usually choose Accident/AD&D'],
        mustNotContain: ['Tell me which area you want to focus on next'],
      },
    ],
  },
  {
    id: 'V2-TX-026',
    category: 'decision_reason_after_routine_care_comparison',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      coverageTierLock: 'Employee + Family',
    },
    turns: [
      {
        user: "what benefit should i pay attention to first if i'm mostly worried about protecting my family?",
        mustContain: ['protecting your family'],
      },
      {
        user: 'routine care',
        mustContain: ['If routine care is what matters most'],
      },
      {
        user: 'yes, do that',
        mustContain: ['deciding between dental and vision as the next add-on'],
      },
      {
        user: 'why would i pick that?',
        mustContain: ['My practical take is to choose dental first'],
        mustNotContain: ['Tell me which area you want to focus on next'],
      },
    ],
  },
  {
    id: 'V2-TX-027',
    category: 'medical_spouse_specific_followup',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'OR',
      dataConfirmed: true,
      coverageTierLock: 'Employee + Family',
      currentTopic: 'Medical',
    },
    turns: [
      {
        user: 'which medical plan should i pick if i have a spouse and 2 kids and we are generally healthy and want the lowest bills?',
        mustContain: ['My recommendation: Standard HSA'],
      },
      {
        user: 'what about for my spouse?',
        mustContain: ['thinking specifically about your spouse', 'If your spouse is generally healthy'],
        mustNotContain: ['Tell me which area you want to focus on next'],
      },
    ],
  },
  {
    id: 'V2-TX-028',
    category: 'medical_decision_reason_variant',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 45,
      userState: 'OR',
      dataConfirmed: true,
      coverageTierLock: 'Employee + Family',
      currentTopic: 'Medical',
    },
    turns: [
      {
        user: 'which medical plan should i pick if i have a spouse and 2 kids and we are generally healthy and want the lowest bills?',
        mustContain: ['My recommendation: Standard HSA'],
      },
      {
        user: 'why that one over the other?',
        mustContain: ['My practical take is that I would usually land on **Standard HSA**'],
        mustNotContain: ['Tell me which area you want to focus on next'],
      },
    ],
  },
  {
    id: 'V2-TX-029',
    category: 'medical_household_wording_variant',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 45,
      userState: 'OR',
      dataConfirmed: true,
      coverageTierLock: 'Employee + Family',
      currentTopic: 'Medical',
    },
    turns: [
      {
        user: 'which medical plan should i pick if i have a spouse and 2 kids and we are generally healthy and want the lowest bills?',
        mustContain: ['My recommendation: Standard HSA'],
      },
      {
        user: 'what if we mostly care about the kids?',
        mustContain: ['thinking specifically about your kids'],
        mustNotContain: ['Tell me which area you want to focus on next'],
      },
    ],
  },
  {
    id: 'V2-TX-030',
    category: 'contextual_benefit_comparison_without_pivot',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
    },
    turns: [
      {
        user: 'dental please',
        mustContain: ['Dental coverage: **BCBSTX Dental PPO**'],
      },
      {
        user: 'is that more important than vision?',
        mustContain: ['deciding between dental and vision as the next add-on'],
        mustNotContain: ['Vision coverage: **VSP Vision Plus**', 'Tell me which area you want to focus on next'],
      },
    ],
  },
  {
    id: 'V2-TX-031',
    category: 'family_narrowing_after_general_guidance',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      coverageTierLock: 'Employee + Family',
    },
    turns: [
      {
        user: 'please help me think through which one of these benefits is worth considering for my situation.',
        mustContain: ['what is actually worth attention first'],
      },
      {
        user: 'what about for our family?',
        mustContain: ['If protecting your family is the top priority', 'life insurance next'],
        mustNotContain: ['Tell me which area you want to focus on next'],
      },
    ],
  },
  {
    id: 'V2-TX-032',
    category: 'cost_narrowing_after_general_guidance',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      coverageTierLock: 'Employee + Family',
    },
    turns: [
      {
        user: 'please help me think through which one of these benefits is worth considering for my situation.',
        mustContain: ['what is actually worth attention first'],
      },
      {
        user: 'we mostly care about cost',
        mustContain: ['If keeping healthcare costs down is the priority', 'Focus on medical first'],
        mustNotContain: ['Tell me which area you want to focus on next'],
      },
    ],
  },
  {
    id: 'V2-TX-033',
    category: 'routine_shorthand_after_general_guidance',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      coverageTierLock: 'Employee + Family',
    },
    turns: [
      {
        user: 'please help me think through which one of these benefits is worth considering for my situation.',
        mustContain: ['what is actually worth attention first'],
      },
      {
        user: 'routine stuff',
        mustContain: ['If routine care is what matters most', 'Look at dental next'],
        mustNotContain: ['Tell me which area you want to focus on next'],
      },
    ],
  },
  {
    id: 'V2-TX-034',
    category: 'medical_cheaper_option_fragment',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'OR',
      dataConfirmed: true,
      coverageTierLock: 'Employee + Family',
      currentTopic: 'Medical',
    },
    turns: [
      {
        user: 'which medical plan should i pick if i have a spouse and 2 kids and we are generally healthy and want the lowest bills?',
        mustContain: ['My recommendation: Standard HSA'],
      },
      {
        user: 'the cheaper one?',
        mustContain: ['cheaper option', '**Standard HSA**'],
        mustNotContain: ['Tell me which area you want to focus on next'],
      },
    ],
  },
  {
    id: 'V2-TX-035',
    category: 'supplemental_risk_fragment',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      currentTopic: 'Accident/AD&D',
    },
    turns: [
      {
        user: 'what is accident/ad&d?',
        mustContain: ['Accident/AD&D coverage is another supplemental option'],
      },
      {
        user: 'yes, help me think through whether that is worth considering',
        mustContain: ['usually worth considering'],
      },
      {
        user: "yes, i'd like that",
        mustContain: ['plain-language difference between Accident/AD&D and Critical Illness'],
      },
      {
        user: 'more injury risk',
        mustContain: ['lean Accident/AD&D first'],
        mustNotContain: ['Tell me which area you want to focus on next'],
      },
    ],
  },
  {
    id: 'V2-TX-036',
    category: 'medical_that_one_fragment',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'OR',
      dataConfirmed: true,
      coverageTierLock: 'Employee + Family',
      currentTopic: 'Medical',
    },
    turns: [
      {
        user: 'which medical plan should i pick if i have a spouse and 2 kids and we are generally healthy and want the lowest bills?',
        mustContain: ['My recommendation: Standard HSA'],
      },
      {
        user: 'that one?',
        mustContain: ['My practical take is that I would usually land on **Standard HSA**'],
        mustNotContain: ['Tell me which area you want to focus on next'],
      },
    ],
  },
  {
    id: 'V2-TX-037',
    category: 'supplemental_diagnosis_risk_fragment',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      currentTopic: 'Accident/AD&D',
    },
    turns: [
      {
        user: 'what is accident/ad&d?',
        mustContain: ['Accident/AD&D coverage is another supplemental option'],
      },
      {
        user: 'yes, help me think through whether that is worth considering',
        mustContain: ['usually worth considering'],
      },
      {
        user: "yes, i'd like that",
        mustContain: ['plain-language difference between Accident/AD&D and Critical Illness'],
      },
      {
        user: 'more diagnosis risk',
        mustContain: ['lean Critical Illness first'],
        mustNotContain: ['Tell me which area you want to focus on next'],
      },
    ],
  },
  {
    id: 'V2-TX-038',
    category: 'hsa_fit_followup_after_guidance',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      currentTopic: 'HSA/FSA',
    },
    turns: [
      {
        user: 'can you tell me about hsa/fsa?',
        mustContain: ['Health Savings Account', 'Flexible Spending Account'],
      },
      {
        user: 'yes, tell me when an hsa is the better fit',
        mustContain: ['simplest way to think about HSA versus FSA fit'],
      },
      {
        user: 'use it this year',
        mustContain: ['FSA is usually the cleaner fit', 'current plan year'],
        mustNotContain: ['Tell me which area you want to focus on next'],
      },
    ],
  },
  {
    id: 'V2-TX-039',
    category: 'medical_family_fragment_kids_then',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'OR',
      dataConfirmed: true,
      coverageTierLock: 'Employee + Family',
      currentTopic: 'Medical',
    },
    turns: [
      {
        user: 'which medical plan should i pick if i have a spouse and 2 kids and we are generally healthy and want the lowest bills?',
        mustContain: ['My recommendation: Standard HSA'],
      },
      {
        user: 'kids then?',
        mustContain: ['thinking specifically about your kids'],
        mustNotContain: ['Tell me which area you want to focus on next'],
      },
    ],
  },
  {
    id: 'V2-TX-040',
    category: 'supplemental_why_not_other_first',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      currentTopic: 'Accident/AD&D',
    },
    turns: [
      {
        user: 'what is accident/ad&d?',
        mustContain: ['Accident/AD&D coverage is another supplemental option'],
      },
      {
        user: 'yes, help me think through whether that is worth considering',
        mustContain: ['usually worth considering'],
      },
      {
        user: "yes, i'd like that",
        mustContain: ['plain-language difference between Accident/AD&D and Critical Illness'],
      },
      {
        user: 'why not critical illness first?',
        mustContain: ['Critical Illness can absolutely come first'],
        mustNotContain: ['Tell me which area you want to focus on next'],
      },
    ],
  },
  {
    id: 'V2-TX-041',
    category: 'family_protection_why_not_disability',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      coverageTierLock: 'Employee + Family',
    },
    turns: [
      {
        user: "what benefit should i pay attention to first if i'm mostly worried about protecting my family?",
        mustContain: ['protecting your family'],
      },
      {
        user: "yes, i'd like that",
        mustContain: ['simplest way to separate life insurance from disability'],
      },
      {
        user: 'why not disability first?',
        mustContain: ['Disability often can come first'],
        mustNotContain: ['Tell me which area you want to focus on next'],
      },
    ],
  },
  {
    id: 'V2-TX-042',
    category: 'routine_care_why_not_vision',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 42,
      userState: 'FL',
      dataConfirmed: true,
      coverageTierLock: 'Employee + Family',
    },
    turns: [
      {
        user: "what benefit should i pay attention to first if i'm mostly worried about protecting my family?",
        mustContain: ['protecting your family'],
      },
      {
        user: 'routine care',
        mustContain: ['If routine care is what matters most'],
      },
      {
        user: 'yes, do that',
        mustContain: ['deciding between dental and vision as the next add-on'],
      },
      {
        user: 'why not vision first?',
        mustContain: ['Vision can absolutely come first'],
        mustNotContain: ['Tell me which area you want to focus on next'],
      },
    ],
  },
];
