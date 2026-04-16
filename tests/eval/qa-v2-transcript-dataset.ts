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
        mustContain: ['**medical**', 'core coverage decision'],
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
        mustContain: ['protecting your family', 'disability next', 'life insurance right after that'],
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
        mustContain: ['simplest way to separate life insurance from disability'],
      },
      {
        user: 'why not life first if my spouse and kids would need support if i die?',
        mustContain: ['Life absolutely can come first', 'support after my death'],
        mustNotContain: ['Tell me which area you want to focus on next'],
      },
    ],
  },
  {
    id: 'V2-TX-020A',
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
        mustContain: ['The reason I leaned Standard HSA', 'keep your own monthly premium lower'],
        mustNotContain: ['Tell me which area you want to focus on next'],
      },
      {
        user: 'is enhanced worth the extra premium?',
        mustContain: ['Whether the higher-cost medical option is worth the extra premium', 'If usage is low, I would usually keep the cheaper option'],
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
        mustContain: ['If protecting your family is the top priority', 'disability next', 'life insurance right after that'],
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
  {
    id: 'V2-TX-042A',
    category: 'family_protection_next_dollar',
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
        user: 'which protection gets the next dollar first: life insurance or disability?',
        mustContain: ['next dollar', 'disability first'],
        mustNotContain: ['Tell me which area you want to focus on next'],
      },
      {
        user: 'if my spouse and kids would need support if i die, which protection gets the next dollar first?',
        mustContain: ['next dollar', 'life insurance first'],
        mustNotContain: ['Tell me which area you want to focus on next'],
      },
    ],
  },
  {
    id: 'V2-TX-043',
    category: 'medical_detail_source_backed',
    initialSession: {
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Medical',
    },
    turns: [
      {
        user: "what's a coverage tier?",
        mustContain: ['A coverage tier is just the level of people you are enrolling', 'Employee + Family'],
        mustNotContain: ['We can stay with medical'],
      },
      {
        user: "okay, let's compare the plan tradeoffs",
        mustContain: ['Here is the practical tradeoff across AmeriVet\'s medical options', 'Standard HSA', 'Enhanced HSA'],
        mustNotContain: ['We can stay with medical'],
      },
      {
        user: 'what are the copays for the standard plan?',
        mustContain: ['Standard HSA point-of-service cost sharing', 'Primary care', 'Specialist'],
        mustNotContain: ['We can stay with medical'],
      },
      {
        user: 'what does primary care mean?',
        mustContain: ['Primary care usually means your everyday doctor visit layer'],
        mustNotContain: ['We can stay with medical'],
      },
      {
        user: 'what does specialist mean?',
        mustContain: ['A specialist visit means care from a doctor focused on a specific area'],
        mustNotContain: ['We can stay with medical'],
      },
      {
        user: 'what does prescription coverage mean?',
        mustContain: ['Prescription coverage is the part of the medical plan', 'do not want to guess'],
        mustNotContain: ['We can stay with medical'],
      },
    ],
  },
  {
    id: 'V2-TX-044',
    category: 'maternity_medical_detail',
    initialSession: {
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Medical',
    },
    turns: [
      {
        user: 'my wife is pregnant',
        mustContain: ['Here is the maternity coverage comparison', 'Standard HSA', 'Enhanced HSA'],
        mustNotContain: ['We can stay with medical'],
      },
      {
        user: 'what coverage will we get for maternity coverage on the 2 different plans?',
        mustContain: ['Here is the maternity coverage comparison', 'Standard HSA', 'Enhanced HSA'],
        mustNotContain: ['We can stay with medical'],
      },
      {
        user: 'what about prescriptions on the standard plan?',
        mustContain: ['Standard HSA', 'do not want to guess'],
        mustNotContain: ['We can stay with medical'],
      },
      {
        user: 'what is the in-network versus out-of-network difference on these plans?',
        mustContain: ['in-network', 'out-of-network'],
        mustNotContain: ['We can stay with medical'],
      },
    ],
  },
  {
    id: 'V2-TX-045',
    category: 'worth_adding_followups',
    initialSession: {
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
    },
    turns: [
      {
        user: 'vision please',
        mustContain: ['Vision coverage: **VSP Vision Plus**'],
      },
      {
        user: "how do i know if it's useful?",
        mustContain: ['Vision is usually worth adding', 'one vision plan'],
        mustNotContain: ['We can stay with vision'],
      },
      {
        user: 'what is accident/ad&d?',
        mustContain: ['Accident/AD&D coverage is another supplemental option'],
      },
      {
        user: 'how do i know if i should get that?',
        mustContain: ['My practical take'],
        mustNotContain: ['We can stay with supplemental protection'],
      },
      {
        user: "yeah- how do i know if it's worth adding?",
        mustContain: ['My practical take'],
        mustNotContain: ['usually worth considering when one of these sounds true'],
      },
    ],
  },
  {
    id: 'V2-TX-046',
    category: 'other_coverage_overview',
    initialSession: {
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Medical',
    },
    turns: [
      {
        user: 'medical',
        mustContain: ['Medical plan options (Employee Only)'],
      },
      {
        user: 'what are the other types of coverage available?',
        mustContain: ['Here are the benefits available to you as an AmeriVet employee', 'Dental', 'Vision', 'Life Insurance'],
        mustNotContain: ['We can stay with medical'],
      },
    ],
  },
  {
    id: 'V2-TX-047',
    category: 'medical_plan_coverage_snapshot',
    initialSession: {
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Spouse',
    },
    turns: [
      {
        user: 'what does the standard plan cover?',
        mustContain: ['Standard HSA coverage snapshot', 'Source-backed plan features', 'Employee + Spouse premium'],
        mustNotContain: ['We can stay with medical'],
      },
      {
        user: 'what about virtual visits on the standard plan?',
        mustContain: ['Standard HSA', 'virtual visits'],
        mustNotContain: ['We can stay with medical'],
      },
    ],
  },
  {
    id: 'V2-TX-047A',
    category: 'medical_benefits_literacy',
    initialSession: {
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Medical',
    },
    turns: [
      {
        user: "what's a copay?",
        mustContain: ['A copay is the flat dollar amount', "AmeriVet's package"],
        mustNotContain: ['We can stay with medical'],
      },
      {
        user: "what's a deductible?",
        mustContain: ['A deductible is the amount you usually pay out of pocket', "AmeriVet's medical plans"],
        mustNotContain: ['We can stay with medical'],
      },
      {
        user: "what's coinsurance?",
        mustContain: ['Coinsurance is the percentage', "AmeriVet's package"],
        mustNotContain: ['We can stay with medical'],
      },
      {
        user: "what's an out-of-pocket max?",
        mustContain: ['The out-of-pocket max is the ceiling', "AmeriVet's package"],
        mustNotContain: ['We can stay with medical'],
      },
      {
        user: 'what does in-network versus out-of-network mean?',
        mustContain: ['In-network means you are using providers inside the plan', 'Out-of-network means you are going outside that network'],
        mustNotContain: ['We can stay with medical'],
      },
    ],
  },
  {
    id: 'V2-TX-047B',
    category: 'routine_benefit_source_backed_details',
    initialSession: {
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
    },
    turns: [
      {
        user: 'dental please',
        mustContain: ['Dental coverage: **BCBSTX Dental PPO**'],
      },
      {
        user: 'what does the dental plan cover for braces?',
        mustContain: ['orthodontia is included', 'Orthodontia copay: $500'],
        mustNotContain: ['We can stay with dental'],
      },
      {
        user: 'what is the waiting period for major services?',
        mustContain: ['Waiting period for major services is 6 months'],
        mustNotContain: ['We can stay with dental'],
      },
      {
        user: 'okay, tell me about my vision options',
        mustContain: ['Vision coverage: **VSP Vision Plus**'],
      },
      {
        user: 'what does the vision plan cover for frames and contacts?',
        mustContain: ['practical vision perks', '$200 frame allowance', 'Contact lens allowance'],
        mustNotContain: ['We can stay with vision'],
      },
      {
        user: 'what does frame allowance mean?',
        mustContain: ['The frame allowance is the amount the vision plan helps toward frames', '$200 frame allowance'],
        mustNotContain: ['We can stay with vision'],
      },
    ],
  },
  {
    id: 'V2-TX-047C',
    category: 'routine_benefit_literacy',
    initialSession: {
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
    },
    turns: [
      {
        user: 'dental please',
        mustContain: ['Dental coverage: **BCBSTX Dental PPO**'],
      },
      {
        user: 'what does preventive care mean?',
        mustContain: ["In AmeriVet's dental plan, preventive care", 'routine care people expect to use'],
        mustNotContain: ['We can stay with dental'],
      },
      {
        user: 'what are major services?',
        mustContain: ['difference is basically about how simple versus expensive the procedure is', 'Major services'],
        mustNotContain: ['We can stay with dental'],
      },
      {
        user: 'okay, tell me about my vision options',
        mustContain: ['Vision coverage: **VSP Vision Plus**'],
      },
      {
        user: 'what does lasik discount mean?',
        mustContain: ['The LASIK discount means', 'more of a perk'],
        mustNotContain: ['We can stay with vision'],
      },
    ],
  },
  {
    id: 'V2-TX-048',
    category: 'supplemental_repeated_worth_it',
    initialSession: {
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
    },
    turns: [
      {
        user: 'what is accident/ad&d?',
        mustContain: ['Accident/AD&D coverage is another supplemental option'],
      },
      {
        user: 'how do i know if i should get that?',
        mustContain: ['My practical take'],
        mustNotContain: ['We can stay with supplemental protection'],
      },
      {
        user: "yeah- how do i know if it's worth adding?",
        mustContain: ['My practical take'],
        mustNotContain: ['usually worth considering when one of these sounds true'],
      },
    ],
  },
  {
    id: 'V2-TX-049',
    category: 'critical_illness_recall_after_package_guidance',
    initialSession: {
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Medical',
    },
    turns: [
      {
        user: 'medical',
        mustContain: ['Medical plan options (Employee Only)'],
      },
      {
        user: 'no, i’m done with medical. what else should i be thinking about?',
        mustContain: ['**Dental**', 'Life insurance'],
      },
      {
        user: "wasn't there one about illness?",
        mustContain: ['Critical illness coverage'],
        mustNotContain: ['We can stay with medical'],
      },
    ],
  },
  {
    id: 'V2-TX-050',
    category: 'non_medical_docs_replacement',
    initialSession: {
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
    },
    turns: [
      {
        user: 'life insurance info',
        mustContain: ['Life insurance options'],
      },
      {
        user: 'what does portable mean here?',
        mustContain: ['Portable means', 'Voluntary Term Life'],
        mustNotContain: ['I can help with life insurance'],
      },
      {
        user: 'what does guaranteed issue mean?',
        mustContain: ['Guaranteed issue means', '$150,000'],
        mustNotContain: ['I can help with life insurance'],
      },
      {
        user: 'what does cash value mean?',
        mustContain: ['Cash value is the savings-like component', 'Whole Life'],
        mustNotContain: ['I can help with life insurance'],
      },
    ],
  },
  {
    id: 'V2-TX-051',
    category: 'medical_practical_followups',
    initialSession: {
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Medical',
    },
    turns: [
      {
        user: 'medical',
        mustContain: ['Medical plan options'],
      },
      {
        user: 'what are the copays for the standard plan?',
        mustContain: ['Standard HSA point-of-service cost sharing', 'Primary care'],
        mustNotContain: ['We can stay with medical'],
      },
      {
        user: 'my wife is pregnant',
        mustContain: ['maternity coverage', 'Standard HSA', 'Enhanced HSA'],
        mustNotContain: ['We can stay with medical'],
      },
    ],
  },
  {
    id: 'V2-TX-052',
    category: 'supplemental_compare_followthrough',
    initialSession: {
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
    },
    turns: [
      {
        user: 'what is accident/ad&d?',
        mustContain: ['Accident/AD&D coverage is another supplemental option'],
      },
      {
        user: 'yes, help me think through whether that is worth considering',
        mustContain: ['Accident/AD&D is usually worth considering'],
      },
      {
        user: "yes, i'd like that",
        mustContain: ['plain-language difference between Accident/AD&D and Critical Illness'],
        mustNotContain: ['I want to keep this grounded'],
      },
    ],
  },
  {
    id: 'V2-TX-053',
    category: 'life_docs_replacement_detail',
    initialSession: {
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
    },
    turns: [
      {
        user: 'life insurance info',
        mustContain: ['Life insurance options'],
      },
      {
        user: 'what does portable mean here?',
        mustContain: ['Portable means', 'Voluntary Term Life'],
        mustNotContain: ['I can help with life insurance'],
      },
      {
        user: 'what does guaranteed issue mean?',
        mustContain: ['Guaranteed issue means', '$150,000'],
        mustNotContain: ['I can help with life insurance'],
      },
      {
        user: 'what does cash value mean?',
        mustContain: ['Cash value is the savings-like component', 'Whole Life'],
        mustNotContain: ['I can help with life insurance'],
      },
      {
        user: 'how much life insurance can i get here?',
        mustContain: ['difference across AmeriVet', 'Basic Life', '1x to 5x annual salary'],
        mustNotContain: ['I can help with life insurance'],
      },
    ],
  },
  {
    id: 'V2-TX-054',
    category: 'disability_docs_replacement_detail',
    initialSession: {
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Disability',
    },
    turns: [
      {
        user: 'tell me about the disability stuff',
        mustContain: ['Disability coverage is meant to protect part of your income'],
      },
      {
        user: 'what is the difference between short-term and long-term disability?',
        mustContain: ['Short-term disability and long-term disability are both income-protection benefits', 'Short-term disability helps with temporary time away from work'],
        mustNotContain: ['We can stay with disability'],
      },
      {
        user: 'how does disability work?',
        mustContain: ['Disability is really paycheck protection'],
        mustNotContain: ['We can stay with disability'],
      },
    ],
  },
  {
    id: 'V2-TX-055',
    category: 'routine_package_literacy',
    initialSession: {
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Vision',
    },
    turns: [
      {
        user: 'vision please',
        mustContain: ['Vision coverage: **VSP Vision Plus**'],
      },
      {
        user: 'what does frame allowance mean?',
        mustContain: ['The frame allowance is the amount the vision plan helps toward frames', '$200 frame allowance'],
        mustNotContain: ['We can stay with vision'],
      },
      {
        user: 'what does lasik discount mean?',
        mustContain: ['The LASIK discount means', 'more of a perk than a reason'],
        mustNotContain: ['We can stay with vision'],
      },
      {
        user: 'dental please',
        mustContain: ['Dental coverage: **BCBSTX Dental PPO**'],
      },
      {
        user: 'what are major services?',
        mustContain: ['difference is basically about how simple versus expensive the procedure is', 'Major services'],
        mustNotContain: ['We can stay with dental'],
      },
    ],
  },
  {
    id: 'V2-TX-056',
    category: 'supplemental_package_literacy',
    initialSession: {
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Disability',
    },
    turns: [
      {
        user: 'tell me about the disability stuff',
        mustContain: ['Disability coverage is meant to protect part of your income'],
      },
      {
        user: 'what are the disability waiting periods and maximum benefits?',
        mustContain: ['does not list the exact disability waiting periods', 'do not want to guess'],
        mustNotContain: ['We can stay with disability'],
      },
      {
        user: 'what is accident/ad&d?',
        mustContain: ['Accident/AD&D coverage is another supplemental option'],
      },
      {
        user: 'what does ad&d mean?',
        mustContain: ['Accident coverage and AD&D travel together', 'loss of life or limb'],
        mustNotContain: ['We can stay with supplemental protection'],
      },
      {
        user: 'what is it not for?',
        mustContain: ['What Accident/AD&D is not', 'not a replacement for your medical plan'],
        mustNotContain: ['We can stay with supplemental protection'],
      },
    ],
  },
  {
    id: 'V2-TX-057',
    category: 'critical_illness_package_literacy',
    initialSession: {
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Critical Illness',
    },
    turns: [
      {
        user: 'critical illness please',
        mustContain: ['Critical illness coverage'],
      },
      {
        user: 'what does lump sum mean here?',
        mustContain: ['lump-sum style cash benefit'],
        mustNotContain: ['We can stay with supplemental protection'],
      },
      {
        user: 'what is it not for?',
        mustContain: ['What critical illness is not', 'not a replacement for your medical plan'],
        mustNotContain: ['We can stay with supplemental protection'],
      },
    ],
  },
  {
    id: 'V2-TX-058',
    category: 'medical_docs_replacement_after_cost_projection',
    initialSession: {
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Spouse',
    },
    turns: [
      {
        user: 'help me think through which one of these benefits is worth considering for my situation. okay, definitely healthcare costs - i want as little out of pocket as possible. my family is pretty healthy and my wife takes 2 prescriptions.',
        mustContain: ['Projected Healthcare Costs for Employee + Spouse coverage'],
      },
      {
        user: 'what are the copays for the standard plan?',
        mustContain: ['Standard HSA point-of-service cost sharing', 'Primary care', 'Specialist'],
        mustNotContain: ['We can stay with medical'],
      },
      {
        user: 'my wife is pregnant',
        mustContain: ['maternity coverage', 'Standard HSA', 'Enhanced HSA'],
        mustNotContain: ['We can stay with medical'],
      },
      {
        user: 'what coverage will we get for maternity coverage on the 2 different plans?',
        mustContain: ['Here is the maternity coverage comparison', 'Standard HSA', 'Enhanced HSA'],
        mustNotContain: ['We can stay with medical'],
      },
      {
        user: 'what are the other types of coverage available?',
        mustContain: ['Here are the benefits available to you as an AmeriVet employee', 'HSA/FSA Accounts'],
      },
    ],
  },
  {
    id: 'V2-TX-059',
    category: 'routine_care_to_protection_flow',
    initialSession: {
      step: 'active_chat',
      userName: 'Charlie',
      hasCollectedName: true,
      userAge: 49,
      userState: 'IA',
      dataConfirmed: true,
      currentTopic: 'Vision',
      completedTopics: ['Dental', 'Vision'],
    },
    turns: [
      {
        user: 'vision please',
        mustContain: ['Vision coverage: **VSP Vision Plus**'],
      },
      {
        user: 'okay, and is that the only option?',
        mustContain: ['whether it is worth adding at all', 'one vision plan'],
        mustNotContain: ['We can stay with vision'],
      },
      {
        user: "how do i know if it's useful?",
        mustContain: ['Vision is usually worth adding', 'one vision plan'],
        mustNotContain: ['We can stay with vision'],
      },
      {
        user: 'do you recommend getting dental?',
        mustContain: ['Dental is usually worth adding', 'whether to add it'],
        mustNotContain: ['We can stay with vision'],
      },
      {
        user: 'okay, tell me about the disability stuff',
        mustContain: ['Disability coverage is meant to protect part of your income'],
      },
    ],
  },
  {
    id: 'V2-TX-060',
    category: 'supplemental_topic_ownership',
    initialSession: {
      step: 'active_chat',
      userName: 'Mandy',
      hasCollectedName: true,
      userAge: 27,
      userState: 'CT',
      dataConfirmed: true,
      currentTopic: 'Critical Illness',
      lastBotMessage: 'Accident/AD&D coverage is another supplemental option. It generally pays benefits after covered accidental injuries, and AD&D adds benefits for severe accidental loss of life or limb.',
    },
    turns: [
      {
        user: 'what is it not for?',
        mustContain: ['What Accident/AD&D is not'],
        mustNotContain: ['What critical illness is not'],
      },
    ],
  },
  {
    id: 'V2-TX-061',
    category: 'supplemental_direct_addon_recommendation',
    initialSession: {
      step: 'active_chat',
      userName: 'Mandy',
      hasCollectedName: true,
      userAge: 27,
      userState: 'CT',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Spouse',
      messages: [
        { role: 'assistant', content: 'My recommendation: Standard HSA.' },
        { role: 'user', content: "based on my family size and overall health, and the fact that i'm choosing the standard plan" },
      ],
    },
    turns: [
      {
        user: 'and should i add critical illness to that?',
        mustContain: ['critical illness', 'medical first'],
        mustNotContain: ['ask that one a little more specifically'],
      },
      {
        user: "based on my family size and overall health, and the fact that i'm choosing the standard plan, should i get critical illness insurance, especially considering i'm the sole bread-winner for my family?",
        mustContain: ['critical illness', 'sole breadwinner'],
        mustNotContain: ['Recommendation for Employee + Spouse coverage'],
      },
      {
        user: 'so should i get it?',
        mustContain: ['critical illness'],
        mustNotContain: ['Recommendation for Employee + Spouse coverage'],
      },
    ],
  },
  {
    id: 'V2-TX-062',
    category: 'contextual_benefits_overview',
    initialSession: {
      step: 'active_chat',
      userName: 'Mandy',
      hasCollectedName: true,
      userAge: 27,
      userState: 'CT',
      dataConfirmed: true,
      currentTopic: 'Medical',
      lastBotMessage: 'Here is the maternity coverage comparison across the available medical plans:',
    },
    turns: [
      {
        user: 'what are the other types of coverage available?',
        mustContain: ['Here are the other benefit areas available to you as an AmeriVet employee'],
        mustNotContain: ['Perfect! 27 in CT.'],
      },
    ],
  },
  {
    id: 'V2-TX-063',
    category: 'medical_docs_replacement_progression',
    initialSession: {
      step: 'active_chat',
      userName: 'Mandy',
      hasCollectedName: true,
      userAge: 27,
      userState: 'CT',
      dataConfirmed: true,
    },
    turns: [
      {
        user: 'medical',
        mustContain: ['Medical plan options', 'Want to compare plans or switch coverage tiers?'],
      },
      {
        user: "what's a coverage tier?",
        mustContain: ['A coverage tier is just the level of people you are enrolling', 'Employee + Family'],
      },
      {
        user: "I'm married and have 3 kids, thank you very much. let's compare the plan tradeoffs",
        mustContain: ['practical tradeoff across AmeriVet', 'Employee + Family'],
      },
      {
        user: "what are the copays for the standard plan?",
        mustContain: ['Standard HSA point-of-service cost sharing', 'Primary care', 'In-network coinsurance'],
      },
      {
        user: 'i am pregnant',
        mustContain: ['maternity coverage comparison', 'Standard HSA', 'Enhanced HSA'],
      },
      {
        user: 'what coverage will we get for maternity coverage on the 2 different plans?',
        mustContain: ['maternity coverage comparison', 'Recommendation', 'Lower OOP numbers indicate better maternity cost protection'],
      },
      {
        user: 'what are the other types of coverage available?',
        mustContain: ['Here are the other benefit areas available to you as an AmeriVet employee', 'HSA/FSA Accounts'],
        mustNotContain: ['Perfect! 27 in CT.'],
      },
    ],
  },
  {
    id: 'V2-TX-064',
    category: 'non_medical_docs_replacement_progression',
    initialSession: {
      step: 'active_chat',
      userName: 'Mandy',
      hasCollectedName: true,
      userAge: 27,
      userState: 'CT',
      dataConfirmed: true,
    },
    turns: [
      {
        user: 'life insurance info',
        mustContain: ['Life insurance options', 'Unum Basic Life & AD&D', 'Allstate Whole Life'],
      },
      {
        user: 'what does portable mean here?',
        mustContain: ['Portable means you may be able to keep that life coverage after leaving AmeriVet', 'Voluntary Term Life'],
      },
      {
        user: 'what does guaranteed issue mean?',
        mustContain: ['Guaranteed issue means there is an amount you can elect during open enrollment without going through full medical underwriting'],
      },
      {
        user: 'what does cash value mean?',
        mustContain: ['Cash value is the savings-like component that builds inside a permanent life policy over time'],
      },
      {
        user: 'how much life insurance can i get here?',
        mustContain: ['practical difference across AmeriVet\'s life-insurance amounts', 'Voluntary Term Life'],
      },
      {
        user: 'what is accident/ad&d?',
        mustContain: ['Accident/AD&D coverage is another supplemental option', 'What it is not'],
      },
      {
        user: 'what is it not for?',
        mustContain: ['What Accident/AD&D is not'],
        mustNotContain: ['What critical illness is not'],
      },
      {
        user: 'critical illness please',
        mustContain: ['Critical illness coverage is a supplemental benefit', 'What it is designed to do'],
      },
      {
        user: 'what is it not for?',
        mustContain: ['What critical illness is not', 'not a replacement for your medical plan'],
      },
    ],
  },
  {
    id: 'V2-TX-065',
    category: 'routine_care_and_protection_followthrough',
    initialSession: {
      step: 'active_chat',
      userName: 'Mandy',
      hasCollectedName: true,
      userAge: 27,
      userState: 'CT',
      dataConfirmed: true,
    },
    turns: [
      {
        user: 'dental please',
        mustContain: ['Dental coverage: **BCBSTX Dental PPO**'],
      },
      {
        user: 'okay, tell me about your vision options',
        mustContain: ['Vision coverage: **VSP Vision Plus**'],
      },
      {
        user: 'is that the only option?',
        mustContain: ['one vision plan', 'worth adding at all'],
      },
      {
        user: "how do i know if it's useful?",
        mustContain: ['Vision is usually worth adding', 'one vision plan'],
      },
      {
        user: 'do you recommend getting dental?',
        mustContain: ['Dental is usually worth adding', 'whether to add it'],
      },
      {
        user: 'okay, tell me about the disability stuff',
        mustContain: ['Disability coverage is meant to protect part of your income'],
      },
    ],
  },
  {
    id: 'V2-TX-066',
    category: 'medical_docs_replacement_chain',
    initialSession: {
      step: 'active_chat',
      userName: 'Mandy',
      hasCollectedName: true,
      userAge: 27,
      userState: 'CT',
      dataConfirmed: true,
    },
    turns: [
      {
        user: 'medical',
        mustContain: ['Medical plan options (Employee Only)'],
      },
      {
        user: "what's a coverage tier?",
        mustContain: ['A coverage tier is just the level of people you are enrolling', 'Employee Only'],
      },
      {
        user: "I'm married and have 3 kids, thank you very much. let's compare the plan tradeoffs",
        mustContain: ['practical tradeoff across AmeriVet', 'Employee + Family'],
      },
      {
        user: 'what are the copays for the standard plan?',
        mustContain: ['Standard HSA point-of-service cost sharing', 'Primary care', 'In-network coinsurance'],
        mustNotContain: ['We can stay with medical'],
      },
      {
        user: 'i am pregnant',
        mustContain: ['maternity coverage comparison', 'Standard HSA', 'Enhanced HSA'],
      },
      {
        user: 'what coverage will we get for maternity coverage on the 2 different plans?',
        mustContain: ['maternity coverage comparison', 'Recommendation'],
      },
      {
        user: 'what are the other types of coverage available?',
        mustContain: ['Here are the other benefit areas available to you as an AmeriVet employee'],
        mustNotContain: ['Perfect! 27 in CT.'],
      },
    ],
  },
  {
    id: 'V2-TX-067',
    category: 'medical_to_supplemental_recommendation_followthrough',
    initialSession: {
      step: 'active_chat',
      userName: 'Mandy',
      hasCollectedName: true,
      userAge: 27,
      userState: 'CT',
      dataConfirmed: true,
    },
    turns: [
      {
        user: 'medical',
        mustContain: ['Medical plan options (Employee Only)'],
      },
      {
        user: "i'm married and have 3 kids, thank you very much. let's compare the plan tradeoffs",
        mustContain: ['Employee + Family premium', 'Standard HSA', 'Enhanced HSA'],
      },
      {
        user: 'and should i add critical illness to that?',
        mustContain: ['critical illness'],
        mustNotContain: ['ask that one a little more specifically', 'Recommendation for Employee + Family coverage'],
      },
      {
        user: "based on my family size and overall health, and the fact that i'm choosing the standard plan, should i get critical illness insurance, especially considering i'm the sole bread-winner for my family?",
        mustContain: ['critical illness'],
        mustNotContain: ['Recommendation for Employee + Family coverage'],
      },
      {
        user: 'so... with my situation, what do you recommend?',
        mustContain: ['critical illness'],
        mustNotContain: ['Recommendation for Employee + Family coverage'],
      },
    ],
  },
  {
    id: 'V2-TX-067B',
    category: 'supplemental_recommendation_yes_followthrough',
    initialSession: {
      step: 'active_chat',
      userName: 'Mandy',
      hasCollectedName: true,
      userAge: 33,
      userState: 'GA',
      dataConfirmed: true,
      currentTopic: 'Disability',
      coverageTierLock: 'Employee + Family',
      familyDetails: { hasSpouse: true, numChildren: 2 },
    },
    turns: [
      {
        user: 'should i get disability if my household depends on my paycheck?',
        mustContain: ['paycheck'],
        mustNotContain: ['ask that one a little more specifically'],
      },
      {
        user: 'yes please',
        mustContain: ['simplest way to separate life insurance from disability', 'if you are alive but unable to work'],
        mustNotContain: ['Disability is usually worth considering if missing part of your paycheck'],
      },
    ],
  },
  {
    id: 'V2-TX-068',
    category: 'household_direct_question_precedence',
    initialSession: {
      step: 'active_chat',
      userName: 'Mandy',
      hasCollectedName: true,
      userAge: 33,
      userState: 'GA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Family',
    },
    turns: [
      {
        user: 'my wife is pregnant',
        mustContain: ['maternity coverage comparison', 'Standard HSA', 'Enhanced HSA'],
      },
      {
        user: 'what gives us the lowest out of pocket?',
        mustContain: ['Kaiser Standard HMO', 'lowest likely maternity-related out-of-pocket exposure', 'Enhanced HSA'],
        mustNotContain: ['Quick clarifier'],
      },
      {
        user: 'other than medical, what are the supplemental benefits?',
        mustContain: ['supplemental benefits are the optional add-ons', 'Life Insurance', 'Disability'],
        mustNotContain: ['We can stay with medical'],
      },
    ],
  },
  {
    id: 'V2-TX-069',
    category: 'chosen_plan_supplemental_continuity',
    initialSession: {
      step: 'active_chat',
      userName: 'Mandy',
      hasCollectedName: true,
      userAge: 33,
      userState: 'GA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Family',
      selectedPlan: 'Standard HSA',
    },
    turns: [
      {
        user: "is critical illness worth it if i'm the sole breadwinner?",
        mustContain: ['critical illness', 'sole breadwinner', 'not yet'],
        mustNotContain: ['Recommendation for Employee + Family coverage'],
      },
      {
        user: "what's next?",
        mustContain: ['life insurance', 'bigger household-protection decision'],
        mustNotContain: ['optional supplemental coverage'],
      },
    ],
  },
  {
    id: 'V2-TX-070',
    category: 'hsa_fsa_practical_fit_followthrough',
    initialSession: {
      step: 'active_chat',
      userName: 'Mandy',
      hasCollectedName: true,
      userAge: 33,
      userState: 'GA',
      dataConfirmed: true,
      currentTopic: 'HSA/FSA',
    },
    turns: [
      {
        user: 'tell me about hsa/fsa',
        mustContain: ['Health Savings Account', 'Flexible Spending Account'],
      },
      {
        user: 'which one is better if i want to spend the money this year?',
        mustContain: ['FSA is usually the cleaner fit'],
        mustNotContain: ['HSA/FSA overview'],
      },
      {
        user: 'what if we are leaning toward standard hsa?',
        mustContain: ['Standard HSA', 'HSA is usually the cleaner fit'],
        mustNotContain: ['HSA/FSA overview'],
      },
      {
        user: 'long-term savings',
        mustContain: ['HSA is usually the cleaner fit', 'compare **Standard HSA** versus **Enhanced HSA** next'],
        mustNotContain: ['We can stay with HSA/FSA'],
      },
      {
        user: 'yes, do that',
        mustContain: ['long-term HSA savings', 'Standard HSA', 'Enhanced HSA'],
        mustNotContain: ['We can stay with HSA/FSA'],
      },
    ],
  },
  {
    id: 'V2-TX-071',
    category: 'hsa_fsa_return_to_medical',
    initialSession: {
      step: 'active_chat',
      userName: 'Mandy',
      hasCollectedName: true,
      userAge: 33,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'HSA/FSA',
    },
    turns: [
      {
        user: 'i just want to see the plans side by side',
        mustContain: ['Here is the practical tradeoff across AmeriVet\'s medical options', 'Standard HSA', 'Enhanced HSA'],
        mustNotContain: ['HSA/FSA overview'],
      },
      {
        user: "nope. i'm done with hsa/fsa. i want to go back to my medical plan options",
        mustContain: ['Medical plan options'],
        mustNotContain: ['HSA/FSA overview'],
      },
    ],
  },
  {
    id: 'V2-TX-072',
    category: 'life_overview_priority_followthrough',
    initialSession: {
      step: 'active_chat',
      userName: 'Mandy',
      hasCollectedName: true,
      userAge: 33,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
    },
    turns: [
      {
        user: "what's available to me?",
        mustContain: ['Life insurance options:', 'Unum Basic Life & AD&D'],
        mustNotContain: ['We can stay with life insurance'],
      },
      {
        user: 'ok. which matters more first?',
        mustContain: ['simplest way to separate life insurance from disability'],
        mustNotContain: ['We can stay with life insurance'],
      },
    ],
  },
  {
    id: 'V2-TX-073',
    category: 'pregnancy_recommendation_direct_followthrough',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 34,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Spouse',
      lifeEvents: ['pregnancy'],
      familyDetails: { hasSpouse: true },
    },
    turns: [
      {
        user: 'which medical plan should i pick for me and my pregnant wife?',
        mustContain: ['My recommendation: Kaiser Standard HMO'],
        mustNotContain: ['We can stay with medical'],
      },
      {
        user: "so why didn't you recommend kaiser?",
        mustContain: ['Kaiser Standard HMO', 'lowest likely maternity-related out-of-pocket exposure'],
        mustNotContain: ['payroll'],
      },
      {
        user: 'what are my other benefit options?',
        mustContain: ['other benefit areas available to you', 'Life Insurance'],
        mustNotContain: ['We can stay with medical'],
      },
    ],
  },
  {
    id: 'V2-TX-074',
    category: 'routine_to_supplemental_and_tier_pivot',
    initialSession: {
      step: 'active_chat',
      userName: 'Sarah',
      hasCollectedName: true,
      userAge: 34,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Vision',
      lifeEvents: ['pregnancy'],
      familyDetails: { hasSpouse: true },
    },
    turns: [
      {
        user: "no - i'm interested in the supplemental protection",
        mustContain: ["AmeriVet's supplemental benefits are the optional add-ons"],
        mustNotContain: ['We can stay with vision'],
      },
      {
        user: 'when i select my plan, do i pick employee + spouse or the family one right now if we are having a baby next february?',
        mustContain: ['Employee + Spouse', 'Employee + Family', 'qualifying life event'],
        mustNotContain: ['We can stay with vision'],
      },
    ],
  },
  {
    id: 'V2-TX-075',
    category: 'package_qle_and_premium_replay_priority',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Child(ren)',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      lifeEvents: ['pregnancy'],
    },
    turns: [
      {
        user: 'knowing what you know about me, which benefits would you recommend i get?',
        mustContain: ['Based on what you have told me, I would usually prioritize your benefits in this order', 'Medical first'],
        mustNotContain: ['We can stay with medical'],
      },
      {
        user: 'after we have our baby, how long do we have to add her to our insurance?',
        mustContain: ['qualifying life event', 'Workday'],
        mustNotContain: ['maternity coverage comparison'],
      },
      {
        user: 'show me how much i have to pay each month on each plan',
        mustContain: ['Here are the monthly medical premiums for Employee + Family coverage in WA', 'Kaiser Standard HMO'],
        mustNotContain: ['We can stay with medical'],
      },
      {
        user: 'yes, do that',
        mustContain: ['Deductible', 'Out-of-pocket max', 'Standard HSA'],
        mustNotContain: ['We can stay with medical'],
      },
    ],
  },
  {
    id: 'V2-TX-075A',
    category: 'package_recommendation_life_context',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      lastBotMessage: 'Life insurance options:\n\n- Unum Basic Life & AD&D is the employer-paid base life and AD&D benefit\n- Unum Voluntary Term Life is the extra employee-paid term coverage\n- Allstate Whole Life is the permanent option with cash value',
    },
    turns: [
      {
        user: 'knowing what you know about me, which benefits would you recommend i get?',
        mustContain: ['keep **medical** as the anchor', 'Voluntary Term Life', 'Whole Life', 'disability'],
        mustNotContain: ['We can stay with life insurance'],
      },
    ],
  },
  {
    id: 'V2-TX-075AA',
    category: 'package_recommendation_hsa_life_context',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      completedTopics: ['Medical', 'Life Insurance'],
      selectedPlan: 'Enhanced HSA',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      lastBotMessage: 'Life insurance options:\n\n- Unum Basic Life & AD&D is the employer-paid base life and AD&D benefit\n- Unum Voluntary Term Life is the extra employee-paid term coverage\n- Allstate Whole Life is the permanent option with cash value',
    },
    turns: [
      {
        user: 'what would you do if you were me with these benefits?',
        mustContain: ['Based on what you have told me', '**disability**', '**HSA/FSA**', '**Enhanced HSA**', '80% Voluntary Term Life / 20% Whole Life', 'Basic Life'],
        mustNotContain: ['We can stay with life insurance'],
      },
    ],
  },
  {
    id: 'V2-TX-075B',
    category: 'medical_term_invite_followthrough',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee Only',
      lastBotMessage: 'Medical plan options (Employee Only):',
    },
    turns: [
      {
        user: 'what is a copay?',
        mustContain: ['A copay is the flat dollar amount you pay', 'compare AmeriVet\'s medical plans specifically on copays next'],
        mustNotContain: ['We can stay with medical'],
      },
      {
        user: 'yes, do that',
        mustContain: ['copays and point-of-service cost sharing comparison', 'primary care', 'specialist'],
        mustNotContain: ['We can stay with medical'],
      },
    ],
  },
  {
    id: 'V2-TX-076',
    category: 'supplemental_narrowing_across_topics',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      familyDetails: { numChildren: 2 },
    },
    turns: [
      {
        user: 'life insurance info',
        mustContain: ['Life insurance options:'],
      },
      {
        user: 'so, if amerivet gives me $25 life insurance, if i spend on something additional, should it be more life insurance, or disability?',
        mustContain: ['choosing between more life insurance and disability', 'disability first'],
        mustNotContain: ['Life insurance options:'],
      },
      {
        user: "you're supposed to help me narrow down whether accident, critical illness, or disability is the most relevant next step for my situation.",
        mustContain: ['narrow down disability versus the smaller supplemental cash benefits', 'disability first'],
        mustNotContain: ['Critical illness coverage is a supplemental benefit'],
      },
    ],
  },
  {
    id: 'V2-TX-077',
    category: 'stale_hsa_fsa_to_medical_recommendation',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'HSA/FSA',
      selectedPlan: 'Standard HSA',
      pendingGuidancePrompt: 'hsa_vs_fsa',
      pendingGuidanceTopic: 'HSA/FSA',
      lastBotMessage: 'HSA/FSA overview:\n\n- HSA stands for Health Savings Account\n- FSA stands for Flexible Spending Account',
    },
    turns: [
      {
        user: 'no - go back to medical and compare the plans for my family',
        mustContain: ['Here is the practical tradeoff across AmeriVet\'s medical options', 'Standard HSA', 'Enhanced HSA'],
        mustNotContain: ['HSA/FSA overview', 'We can stay with medical'],
      },
      {
        user: 'which one is better if we expect a lot of care?',
        mustContain: ['My recommendation: Enhanced HSA', 'Because you described more than minimal usage'],
        mustNotContain: ['My recommendation: Standard HSA', 'We can stay with medical'],
      },
    ],
  },
  {
    id: 'V2-TX-077B',
    category: 'hsa_fsa_rollover_rules_followup',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'HSA/FSA',
      selectedPlan: 'Standard HSA',
      lastBotMessage: 'HSA/FSA overview:\n\n- HSA stands for Health Savings Account\n- FSA stands for Flexible Spending Account',
    },
    turns: [
      {
        user: 'is there a limit to how much unused funds can roll forward?',
        mustContain: ['unused HSA money generally **rolls forward year to year**', 'IRS annual contribution limit', '$4,300'],
        mustNotContain: ['We can stay with HSA/FSA'],
      },
      {
        user: 'can you tell me what the tax and rollover tradeoff means in practice?',
        mustContain: ['tax and rollover tradeoff', 'Unused **HSA** money stays with you', 'stricter carryover or use-it-or-lose-it rules'],
        mustNotContain: ['We can stay with HSA/FSA'],
      },
    ],
  },
  {
    id: 'V2-TX-078',
    category: 'selected_plan_reconsideration_priority',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      selectedPlan: 'Standard HSA',
      coverageTierLock: 'Employee + Family',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      lastBotMessage: 'Recommendation for Employee + Family coverage:\n\nMy recommendation: Standard HSA.',
    },
    turns: [
      {
        user: 'i know i said standard before, but make the case for enhanced if we expect more specialist visits',
        mustContain: ['My recommendation: Enhanced HSA', 'specialist visits'],
        mustNotContain: ['My recommendation: Standard HSA', 'We can stay with medical'],
      },
      {
        user: 'should we switch from standard to enhanced if we expect a lot of care this year?',
        mustContain: ['My recommendation: Enhanced HSA', 'lower deductible and stronger cost protection'],
        mustNotContain: ['My recommendation: Standard HSA', 'We can stay with medical'],
      },
    ],
  },
  {
    id: 'V2-TX-078A',
    category: 'medical_recommendation_preference_signals',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'TX',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee Only',
      lastBotMessage: 'Here is the practical tradeoff across AmeriVet\'s medical options.',
    },
    turns: [
      {
        user: 'which plan do you recommend if i want more predictable costs and less deductible risk?',
        mustContain: ['My recommendation: Enhanced HSA', 'Because you said more predictable costs matter'],
        mustNotContain: ['Quick clarifier', 'would you say your expected usage is'],
      },
      {
        user: 'okay, but what if i can handle more risk to keep premiums lower?',
        mustContain: ['My recommendation: Standard HSA', 'Because you said you can tolerate more cost risk to keep premiums lower'],
        mustNotContain: ['Quick clarifier', 'My recommendation: Enhanced HSA'],
      },
    ],
  },
  {
    id: 'V2-TX-078B',
    category: 'package_guidance_after_settled_medical_choice',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'TX',
      dataConfirmed: true,
      currentTopic: 'Medical',
      completedTopics: ['Medical'],
      selectedPlan: 'Enhanced HSA',
    },
    turns: [
      {
        user: 'what else should i consider?',
        mustContain: ['Because you are leaning toward **Enhanced HSA**', 'HSA/FSA'],
        mustNotContain: ['dental/vision if you want to round out routine care coverage'],
      },
    ],
  },
  {
    id: 'V2-TX-078B2',
    category: 'package_guidance_after_family_medical_pricing',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'TX',
      dataConfirmed: true,
      currentTopic: 'Medical',
      completedTopics: ['Medical'],
      coverageTierLock: 'Employee + Child(ren)',
      familyDetails: { numChildren: 2 },
      lastBotMessage: 'Medical plan options (Employee + Child(ren)):',
    },
    turns: [
      {
        user: 'what else should i consider?',
        mustContain: ['split the next step after medical into two lanes', '**dental**', '**life insurance**', 'default nudge here is usually **dental first**'],
        mustNotContain: ['the next most useful step after medical is usually **life insurance**'],
      },
    ],
  },
  {
    id: 'V2-TX-078B3',
    category: 'package_guidance_after_family_medical_followthrough',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'TX',
      dataConfirmed: true,
      currentTopic: 'Medical',
      completedTopics: ['Medical'],
      coverageTierLock: 'Employee + Child(ren)',
      familyDetails: { numChildren: 2 },
      lastBotMessage: 'Medical plan options (Employee + Child(ren)):',
    },
    turns: [
      {
        user: 'what else should i consider?',
        mustContain: ['split the next step after medical into two lanes', '**dental**', '**life insurance**', 'default nudge here is usually **dental first**'],
      },
      {
        user: 'yes, do that',
        mustContain: ['Dental coverage: **BCBSTX Dental PPO**'],
        mustNotContain: ['Life insurance options:'],
      },
    ],
  },
  {
    id: 'V2-TX-078C',
    category: 'package_guidance_after_routine_care_settled',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Vision',
      completedTopics: ['Medical', 'Dental', 'Vision'],
      coverageTierLock: 'Employee + Family',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      selectedPlan: 'Enhanced HSA',
    },
    turns: [
      {
        user: 'what should i look at next?',
        mustContain: ['routine care questions look more settled', 'life insurance', 'take you straight into **life insurance** next'],
        mustNotContain: ['dental is the natural companion', 'vision is the natural companion'],
      },
    ],
  },
  {
    id: 'V2-TX-078D',
    category: 'package_guidance_after_hsa_family_followup',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'HSA/FSA',
      completedTopics: ['Medical', 'HSA/FSA'],
      coverageTierLock: 'Employee + Family',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      selectedPlan: 'Standard HSA',
    },
    turns: [
      {
        user: "what's next?",
        mustContain: ['life insurance', 'household protection is usually the bigger remaining decision'],
        mustNotContain: ['Going back to your medical choice'],
      },
    ],
  },
  {
    id: 'V2-TX-078E',
    category: 'package_guidance_affirmation_into_hsa_overview',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'TX',
      dataConfirmed: true,
      currentTopic: 'Medical',
      completedTopics: ['Medical'],
      selectedPlan: 'Enhanced HSA',
    },
    turns: [
      {
        user: 'what else should i consider?',
        mustContain: ['Because you are leaning toward **Enhanced HSA**', 'HSA/FSA'],
      },
      {
        user: 'yes, do that',
        mustContain: ['HSA is usually the cleaner fit', 'tax account aligned'],
        mustNotContain: ['Because you are leaning toward **Enhanced HSA**'],
      },
    ],
  },
  {
    id: 'V2-TX-078F',
    category: 'package_guidance_affirmation_into_life_details',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Vision',
      completedTopics: ['Medical', 'Dental', 'Vision'],
      coverageTierLock: 'Employee + Family',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      selectedPlan: 'Enhanced HSA',
    },
    turns: [
      {
        user: 'what should i look at next?',
        mustContain: ['routine care questions look more settled', 'life insurance'],
      },
      {
        user: 'yes, do that',
        mustContain: ['Life insurance options:', 'Unum Basic Life & AD&D'],
        mustNotContain: ['routine care questions look more settled'],
      },
    ],
  },
  {
    id: 'V2-TX-078FA',
    category: 'package_guidance_affirmation_into_life_disability_compare_from_life',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      completedTopics: ['Medical', 'Life Insurance'],
      coverageTierLock: 'Employee + Family',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      selectedPlan: 'Enhanced HSA',
    },
    turns: [
      {
        user: 'what else should i consider?',
        mustContain: ['most useful next comparison is usually **disability**'],
      },
      {
        user: 'yes, do that',
        mustContain: ['simplest way to separate life insurance from disability'],
        mustNotContain: ['Disability coverage is meant to protect part of your income'],
      },
    ],
  },
  {
    id: 'V2-TX-078FB',
    category: 'package_guidance_affirmation_into_life_disability_compare_from_disability',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Disability',
      completedTopics: ['Medical', 'Disability'],
      coverageTierLock: 'Employee + Family',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      selectedPlan: 'Enhanced HSA',
    },
    turns: [
      {
        user: 'what else should i consider?',
        mustContain: ['most useful companion benefit is usually **life insurance**'],
      },
      {
        user: 'yes, do that',
        mustContain: ['simplest way to separate life insurance from disability'],
        mustNotContain: ['Life insurance options:'],
      },
    ],
  },
  {
    id: 'V2-TX-078G',
    category: 'medical_rx_self_service_lookup',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'TX',
      dataConfirmed: true,
      currentTopic: 'Medical',
      lastBotMessage: 'Here is the prescription coverage comparison across the available medical plans:\n\n- Standard HSA: I do not have the prescription drug tier details in the current summary, so I do not want to guess.',
    },
    turns: [
      {
        user: 'where can i go to see the rx costs myself?',
        mustContain: ['Workday', 'prescription tiers or drug-pricing details', 'carrier formulary / drug-pricing tool', 'compare the medical options at a high level for someone who expects ongoing prescriptions'],
        mustNotContain: ['We can stay with medical'],
      },
      {
        user: 'yes, do that',
        mustContain: ['My recommendation:', 'ongoing prescriptions'],
        mustNotContain: ['Workday'],
      },
    ],
  },
  {
    id: 'V2-TX-078H',
    category: 'critical_illness_cost_lookup',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'TX',
      dataConfirmed: true,
      currentTopic: 'Critical Illness',
      lastBotMessage: 'Critical illness coverage is a supplemental benefit that can pay a lump-sum cash benefit if you are diagnosed with a covered serious condition.',
    },
    turns: [
      {
        user: 'can you give me a ballpark idea of what the ci insurance would cost?',
        mustContain: ['do **not** have a grounded flat-rate premium', 'Workday'],
        mustNotContain: ['We can stay with supplemental protection'],
      },
      {
        user: 'yes, do that',
        mustContain: ['Critical illness is usually worth considering'],
        mustNotContain: ['do **not** have a grounded flat-rate premium'],
      },
    ],
  },
  {
    id: 'V2-TX-079',
    category: 'household_tier_correction_overwrites_stale_pricing',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Spouse',
      familyDetails: { hasSpouse: true },
      lastBotMessage: 'Projected Healthcare Costs for Employee + Spouse coverage in Washington (moderate usage):',
    },
    turns: [
      {
        user: 'actually compare the costs for employee + family since we have 2 kids',
        mustContain: ['Projected Healthcare Costs for Employee + Family coverage in Washington', 'Kaiser Standard HMO'],
        mustNotContain: ['Employee + Spouse coverage'],
      },
      {
        user: 'actually it is just me and the 2 kids now, so show me the employee + child pricing',
        mustContain: ['Here are the monthly medical premiums for Employee + Child(ren) coverage in WA', 'Standard HSA'],
        mustNotContain: ['Employee + Family coverage', 'Employee + Spouse coverage'],
      },
    ],
  },
  {
    id: 'V2-TX-079B',
    category: 'household_only_medical_correction_refreshes_view',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee Only',
      lastBotMessage: 'A coverage tier is the level of people you are enrolling.',
    },
    turns: [
      {
        user: 'oh okay, no i have 2 kids',
        mustContain: ['updated the household to **Employee + Child(ren)** coverage', 'Medical plan options (Employee + Child(ren))'],
        mustNotContain: ['We can stay with medical'],
      },
    ],
  },
  {
    id: 'V2-TX-079C',
    category: 'household_only_medical_correction_flows_into_package_guidance',
    initialSession: {
      step: 'active_chat',
      userName: 'Susie',
      hasCollectedName: true,
      userAge: 23,
      userState: 'OR',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee Only',
      completedTopics: ['Medical'],
      lastBotMessage: 'Medical plan options (Employee Only):\n\nWant to compare plans or switch coverage tiers?',
    },
    turns: [
      {
        user: "what's a coverage tier?",
        mustContain: ['A coverage tier is just the level of people you are enrolling', 'Employee Only'],
      },
      {
        user: 'oh okay, no i have 2 kids',
        mustContain: ['updated the household to **Employee + Child(ren)** coverage', 'Medical plan options (Employee + Child(ren))'],
      },
      {
        user: 'okay can you show me the plans for my coverage tier',
        mustContain: ['Medical plan options (Employee + Child(ren))', 'Want to compare plans or switch coverage tiers?'],
      },
      {
        user: 'what else should i consider?',
        mustContain: ['split the next step after medical into two lanes', '**dental**', '**life insurance**', 'default nudge here is usually **dental first**', 'take you straight into **dental** next'],
        mustNotContain: ['the next most useful step after medical is usually **life insurance**'],
      },
    ],
  },
  {
    id: 'V2-TX-080',
    category: 'name_correction_onboarding_continuity',
    initialSession: {
      step: 'start',
      context: {},
    },
    turns: [
      {
        user: 'Sarah',
        mustContain: ['share your age and state next'],
      },
      {
        user: "actually, i'm Melodie",
        mustContain: ['updated your name to Melodie', 'age and state'],
        mustNotContain: ['updated your state to', 'Perfect!'],
      },
      {
        user: '35, FL',
        mustContain: ['Perfect! 35 in FL.'],
      },
      {
        user: 'medical please',
        mustContain: ['Medical plan options'],
      },
    ],
  },
  {
    id: 'V2-TX-081',
    category: 'state_correction_no_topic_continues_into_requested_topic',
    initialSession: {
      step: 'active_chat',
      userName: 'Guy',
      hasCollectedName: true,
      userAge: 43,
      userState: 'TX',
      dataConfirmed: true,
    },
    turns: [
      {
        user: "actually, i'm in WA. medical please",
        mustContain: ['updated your state to WA', 'updated medical view', 'Medical plan options'],
        mustNotContain: ['What would you like to explore first?', 'Please ask that one a little more specifically'],
      },
    ],
  },
  {
    id: 'V2-TX-082',
    category: 'bare_pivot_and_next_phrase_continuity',
    initialSession: {
      step: 'active_chat',
      userName: 'Madeline',
      hasCollectedName: true,
      userAge: 29,
      userState: 'CO',
      dataConfirmed: true,
      currentTopic: 'Vision',
      completedTopics: ['Dental', 'Vision'],
      lastBotMessage: 'Since you have already looked at dental too, the next most useful area is usually:\n\n- life, disability, or supplemental protection',
    },
    turns: [
      {
        user: 'life',
        mustContain: ['Life insurance options:'],
        mustNotContain: ['We can stay with vision'],
      },
      {
        user: 'ok lets do disability next',
        mustContain: ['Disability coverage is meant to protect part of your income'],
        mustNotContain: ['We can stay with life insurance', 'Please ask that one a little more specifically'],
      },
    ],
  },
  {
    id: 'V2-TX-083',
    category: 'life_next_please_pivot_continuity',
    initialSession: {
      step: 'active_chat',
      userName: 'Madeline',
      hasCollectedName: true,
      userAge: 29,
      userState: 'CO',
      dataConfirmed: true,
      currentTopic: 'Vision',
      completedTopics: ['Dental', 'Vision'],
      lastBotMessage: 'If routine care questions are settled, the next most useful area is usually life, disability, or supplemental benefits.',
    },
    turns: [
      {
        user: 'life next please',
        mustContain: ['Life insurance options:'],
        mustNotContain: ['We can stay with vision', 'Please ask that one a little more specifically'],
      },
    ],
  },
  {
    id: 'V2-TX-084',
    category: 'hsa_fit_followup_variant',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'HSA/FSA',
      lastBotMessage: 'HSA/FSA overview:\n\n- HSA stands for Health Savings Account\n- FSA stands for Flexible Spending Account',
    },
    turns: [
      {
        user: 'how do i know when hsa fits better?',
        mustContain: ['simplest way to think about HSA versus FSA fit'],
        mustNotContain: ['We can stay with HSA/FSA'],
      },
    ],
  },
  {
    id: 'V2-TX-085',
    category: 'life_followup_no_name_drift',
    initialSession: {
      step: 'active_chat',
      userName: 'Leo',
      hasCollectedName: true,
      userAge: 72,
      userState: 'MN',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      lastBotMessage: 'Life insurance options:\n\n- Unum Basic Life & AD&D\n- Unum Voluntary Term Life\n- Allstate Whole Life',
    },
    turns: [
      {
        user: "i'm thinking about that voluntary term one. what else should i know?",
        mustContain: ['Voluntary Term Life'],
        mustNotContain: ['updated your name'],
      },
    ],
  },
  {
    id: 'V2-TX-086',
    category: 'life_default_and_amount_followthrough',
    initialSession: {
      step: 'active_chat',
      userName: 'Thomas',
      hasCollectedName: true,
      userAge: 56,
      userState: 'CO',
      dataConfirmed: true,
      familyDetails: { hasSpouse: true, numChildren: 2 },
    },
    turns: [
      {
        user: 'life insurance info',
        mustContain: ['Life insurance options:'],
      },
      {
        user: 'if i do nothing, what life insurance do i get?',
        mustContain: ['Basic Life & AD&D', '$25,000', 'employer-paid'],
        mustNotContain: ['Life insurance options:'],
      },
      {
        user: 'can you help me decide how much voluntary term life i should get?',
        mustContain: ['practical way I would decide how much life insurance to add', 'Voluntary Term Life', '$25,000'],
        mustNotContain: ['Life insurance options:'],
      },
    ],
  },
  {
    id: 'V2-TX-087',
    category: 'hsa_recommendation_followthrough',
    initialSession: {
      step: 'active_chat',
      userName: 'Thomas',
      hasCollectedName: true,
      userAge: 56,
      userState: 'CO',
      dataConfirmed: true,
    },
    turns: [
      {
        user: 'tell me about hsa/fsa',
        mustContain: ['HSA/FSA overview:'],
      },
      {
        user: 'can i use fsa with a hsa plan though?',
        mustContain: ['current plan year', 'HSA-qualified medical plan'],
        mustNotContain: ['A useful next HSA/FSA question is usually one of these'],
      },
      {
        user: 'so what do you recommend to me?',
        mustContain: ['My practical take', 'HSA'],
        mustNotContain: ['A useful next HSA/FSA question is usually one of these'],
      },
    ],
  },
  {
    id: 'V2-TX-088',
    category: 'life_included_and_determine_amount_variants',
    initialSession: {
      step: 'active_chat',
      userName: 'Thomas',
      hasCollectedName: true,
      userAge: 56,
      userState: 'CO',
      dataConfirmed: true,
      familyDetails: { hasSpouse: true, numChildren: 2 },
    },
    turns: [
      {
        user: 'life insurance info',
        mustContain: ['Life insurance options:'],
      },
      {
        user: 'are any of those life insurance plans something i just get without having to pay more?',
        mustContain: ['Basic Life & AD&D', '$25,000', 'employer-paid'],
        mustNotContain: ['Life insurance options:'],
      },
      {
        user: 'can you help me determine how much voluntary term life insurance i should get?',
        mustContain: ['practical way I would decide how much life insurance to add', 'Voluntary Term Life', '$25,000'],
        mustNotContain: ['Here is the practical takeaway on **Voluntary Term Life**', 'Life insurance options:'],
      },
    ],
  },
  {
    id: 'V2-TX-089',
    category: 'hsa_context_returns_to_medical_compare',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'HSA/FSA',
    },
    turns: [
      {
        user: 'yeah - compare the Standard HSA with the Kaiser plan',
        mustContain: ['Standard HSA', 'Kaiser Standard HMO'],
        mustNotContain: ['FSA is usually the more natural pre-tax account', 'HSA/FSA overview'],
      },
      {
        user: 'can you just show me the breakdown of each of those plans though?',
        mustContain: ['Standard HSA', 'Kaiser Standard HMO'],
        mustNotContain: ['A useful next HSA/FSA question is usually one of these'],
      },
    ],
  },
  {
    id: 'V2-TX-090',
    category: 'whole_family_premium_replay',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Family',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      lastBotMessage: 'Here is the practical tradeoff across AmeriVet\'s medical options.',
    },
    turns: [
      {
        user: 'actually i just want to see how much the premiums are for my whole family',
        mustContain: ['Here are the monthly medical premiums for Employee + Family coverage', 'Standard HSA'],
        mustNotContain: ['A useful next medical step is usually one of these'],
      },
    ],
  },
  {
    id: 'V2-TX-091',
    category: 'life_negative_pivot',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      completedTopics: ['Medical', 'Life Insurance'],
      familyDetails: { hasSpouse: true, numChildren: 2 },
    },
    turns: [
      {
        user: 'other than life insurance, what else should i consider next?',
        mustContain: ['disability'],
        mustNotContain: ['Life insurance options:'],
      },
    ],
  },
  {
    id: 'V2-TX-091A',
    category: 'life_next_guidance_with_hsa_followthrough',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      completedTopics: ['Medical', 'Life Insurance'],
      familyDetails: { hasSpouse: true, numChildren: 2 },
      selectedPlan: 'Enhanced HSA',
    },
    turns: [
      {
        user: 'what else should i be considering to my benefits?',
        mustContain: ['**disability**', '**HSA/FSA**', '**Enhanced HSA**'],
        mustNotContain: ['smaller add-on questions'],
      },
    ],
  },
  {
    id: 'V2-TX-091B',
    category: 'life_to_hsa_next_guidance_after_protection',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      completedTopics: ['Medical', 'Life Insurance', 'Disability'],
      familyDetails: { hasSpouse: true, numChildren: 2 },
      selectedPlan: 'Enhanced HSA',
    },
    turns: [
      {
        user: 'what should i look at next?',
        mustContain: ['**HSA/FSA**', '**Enhanced HSA**'],
        mustNotContain: ['smaller add-on questions'],
      },
    ],
  },
  {
    id: 'V2-TX-092',
    category: 'life_employer_guidance_split',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      lastBotMessage: 'Life insurance options:\n\n- **Unum Basic Life & AD&D**',
    },
    turns: [
      {
        user: 'what split do you recommend between whole life and voluntary term life?',
        mustContain: ['80% Voluntary Term Life / 20% Whole Life'],
        mustNotContain: ['life insurance is usually worth tightening up'],
      },
    ],
  },
  {
    id: 'V2-TX-093',
    category: 'life_employer_guidance_broader_family_trigger',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      lastBotMessage: 'Here is the practical difference across AmeriVet\'s life insurance options:\n\n- Unum Basic Life & AD&D is the employer-paid base life and AD&D benefit\n- Unum Voluntary Term Life is the extra employee-paid term coverage\n- Allstate Whole Life is the permanent option with cash value',
    },
    turns: [
      {
        user: 'which ones should i get?',
        mustContain: ['80% Voluntary Term Life / 20% Whole Life'],
        mustNotContain: ['life insurance is usually worth tightening up'],
      },
    ],
  },
  {
    id: 'V2-TX-093A',
    category: 'life_generic_decision_framework',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      lastBotMessage: 'Life insurance options:\n\n- Unum Basic Life & AD&D is the employer-paid base life and AD&D benefit\n- Unum Voluntary Term Life is the extra employee-paid term coverage\n- Allstate Whole Life is the permanent option with cash value',
    },
    turns: [
      {
        user: 'which of those should i get?',
        mustContain: ['Basic Life', 'Voluntary Term Life', 'Whole Life'],
        mustNotContain: ['life insurance is usually worth tightening up'],
      },
      {
        user: 'how much should i get?',
        mustContain: ['Basic Life', 'Voluntary Term Life', 'Whole Life'],
        mustNotContain: ['life insurance is usually worth tightening up'],
      },
    ],
  },
  {
    id: 'V2-TX-093AA',
    category: 'life_soft_worth_it_framework',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      lastBotMessage: 'Life insurance options:\n\n- Unum Basic Life & AD&D is the employer-paid base life and AD&D benefit\n- Unum Voluntary Term Life is the extra employee-paid term coverage\n- Allstate Whole Life is the permanent option with cash value',
    },
    turns: [
      {
        user: 'is life insurance right for me?',
        mustContain: ['Basic Life', 'Voluntary Term Life', 'Whole Life'],
        mustNotContain: ['life insurance is usually worth tightening up'],
      },
    ],
  },
  {
    id: 'V2-TX-094',
    category: 'life_employer_guidance_broader_amount_trigger',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      lastBotMessage: 'Life insurance options:\n\n- Unum Basic Life & AD&D is the employer-paid base life and AD&D benefit\n- Unum Voluntary Term Life is the extra employee-paid term coverage\n- Allstate Whole Life is the permanent option with cash value',
    },
    turns: [
      {
        user: 'how much should i get?',
        mustContain: ['80% Voluntary Term Life / 20% Whole Life', 'Basic Life', 'Voluntary Term Life'],
        mustNotContain: ['life insurance is usually worth tightening up'],
      },
    ],
  },
  {
    id: 'V2-TX-0940',
    category: 'life_employer_guidance_included_base_followup',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      lastBotMessage: 'If you do nothing, AmeriVet still gives you Basic Life & AD&D as the included base layer.',
    },
    turns: [
      {
        user: 'what do you recommend?',
        mustContain: ['80% Voluntary Term Life / 20% Whole Life', 'Basic Life', 'Voluntary Term Life'],
        mustNotContain: ['life insurance is usually worth tightening up'],
      },
    ],
  },
  {
    id: 'V2-TX-094A',
    category: 'life_employer_guidance_soft_recommendation_trigger',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      lastBotMessage: 'Here is the practical difference across AmeriVet\'s life insurance options:\n\n- Unum Basic Life & AD&D is the employer-paid base life and AD&D benefit\n- Unum Voluntary Term Life is the extra employee-paid term coverage\n- Allstate Whole Life is the permanent option with cash value',
    },
    turns: [
      {
        user: 'how much would you recommend?',
        mustContain: ['80% Voluntary Term Life / 20% Whole Life', 'Basic Life', 'Voluntary Term Life'],
        mustNotContain: ['life insurance is usually worth tightening up'],
      },
    ],
  },
  {
    id: 'V2-TX-094B',
    category: 'life_employer_guidance_direct_extra_life_recommendation',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      familyDetails: { hasSpouse: true, numChildren: 2 },
    },
    turns: [
      {
        user: 'i have a wife and 2 kids and want more than just the basic life coverage. what do you recommend?',
        mustContain: ['80% Voluntary Term Life / 20% Whole Life', 'Basic Life', 'Voluntary Term Life'],
        mustNotContain: ['life insurance is usually worth tightening up'],
      },
    ],
  },
  {
    id: 'V2-TX-094C',
    category: 'life_employer_guidance_active_topic_family_wording',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      lastBotMessage: 'My practical take: life insurance is usually worth tightening up if other people rely on your income and would need support if something happened to you.',
    },
    turns: [
      {
        user: 'ok, so i have a wife and 2 kids. so i want life insurance. i think i also want voluntary term - can you help me with that?',
        mustContain: ['80% Voluntary Term Life / 20% Whole Life', 'Basic Life', 'Voluntary Term Life'],
        mustNotContain: ['life insurance is usually worth tightening up'],
      },
    ],
  },
  {
    id: 'V2-TX-095',
    category: 'life_employer_guidance_family_protection_followthrough',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      lastBotMessage: 'A useful next life-insurance step is usually one of these:\n\n- Whether life or disability matters more first\n- How much protection is worth paying for if your family relies on your income',
    },
    turns: [
      {
        user: 'how much protection is worth paying for if your family relies on your income?',
        mustContain: ['80% Voluntary Term Life / 20% Whole Life', 'Basic Life', 'If you can only afford **one** extra paid life layer', 'Whole Life'],
        mustNotContain: ['life insurance is usually worth tightening up'],
      },
    ],
  },
  {
    id: 'V2-TX-096',
    category: 'life_employer_guidance_longer_thread',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      familyDetails: { hasSpouse: true, numChildren: 2 },
    },
    turns: [
      {
        user: 'life insurance info',
        mustContain: ['Life insurance options:'],
      },
      {
        user: 'which ones should i get?',
        mustContain: ['80% Voluntary Term Life / 20% Whole Life'],
        mustNotContain: ['life insurance is usually worth tightening up'],
      },
      {
        user: 'how much should i get?',
        mustContain: ['80% Voluntary Term Life / 20% Whole Life', 'Basic Life'],
        mustNotContain: ['life insurance is usually worth tightening up'],
      },
      {
        user: 'how much protection is worth paying for if your family relies on your income?',
        mustContain: ['80% Voluntary Term Life / 20% Whole Life', 'Voluntary Term Life'],
        mustNotContain: ['life insurance is usually worth tightening up'],
      },
    ],
  },
  {
    id: 'V2-TX-096A',
    category: 'active_topic_contextual_fallbacks',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      lastBotMessage: 'Life insurance options:\n\n- **Unum Basic Life & AD&D**',
    },
    turns: [
      {
        user: 'what else?',
        mustContain: ['most useful next comparison is usually **disability**'],
        mustNotContain: ['Please ask that one a little more specifically'],
      },
    ],
  },
  {
    id: 'V2-TX-096C',
    category: 'life_employer_guidance_history_sensitive_followups',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      messages: [
        { role: 'user', content: 'life insurance info' },
        { role: 'assistant', content: 'Life insurance options:\n\n- Unum Basic Life & AD&D is the employer-paid base life and AD&D benefit\n- Unum Voluntary Term Life is the extra employee-paid term coverage\n- Allstate Whole Life is the permanent option with cash value' },
        { role: 'user', content: 'how much protection is worth paying for if your family relies on your income?' },
        { role: 'assistant', content: 'If you are asking how I would structure extra life coverage once the included base benefit is not enough, AmeriVet\'s current employer guidance is **80% Voluntary Term Life / 20% Whole Life**.' },
      ],
      lastBotMessage: 'My practical take is that if people rely on your income, I would not leave life insurance as an afterthought.',
    },
    turns: [
      {
        user: 'which of those should i get?',
        mustContain: ['80% Voluntary Term Life / 20% Whole Life', 'Voluntary Term Life'],
        mustNotContain: ['life insurance is usually worth tightening up'],
      },
      {
        user: 'how much should i get?',
        mustContain: ['80% Voluntary Term Life / 20% Whole Life', 'Basic Life'],
        mustNotContain: ['life insurance is usually worth tightening up'],
      },
    ],
  },
  {
    id: 'V2-TX-096C2',
    category: 'life_employer_guidance_active_topic_followthrough',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      lastBotMessage: 'My practical take is that if people rely on your income, I would not leave life insurance as an afterthought.',
    },
    turns: [
      {
        user: 'yes please - help me think through that',
        mustContain: ['80% Voluntary Term Life / 20% Whole Life', 'Basic Life', 'Voluntary Term Life', 'Whole Life'],
        mustNotContain: ['A useful next life-insurance step', 'A supplemental benefit is usually worth considering'],
      },
    ],
  },
  {
    id: 'V2-TX-096C3',
    category: 'life_employer_guidance_sizing_followthrough',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      pendingGuidancePrompt: 'life_sizing',
      pendingGuidanceTopic: 'Life Insurance',
      lastBotMessage: 'The practical way I would decide how much life insurance to add is this:\n\n- treat **Basic Life** as the included starting point\n- use **Voluntary Term Life** as the first extra layer\n- use **Whole Life** only if you specifically want permanent coverage',
    },
    turns: [
      {
        user: 'yes please - help me think through that',
        mustContain: ['80% Voluntary Term Life / 20% Whole Life', 'Basic Life', 'Voluntary Term Life', 'Whole Life'],
        mustNotContain: ['life insurance is usually worth tightening up'],
      },
      {
        user: 'how much protection is worth paying for if your family relies on your income?',
        mustContain: ['80% Voluntary Term Life / 20% Whole Life', 'Basic Life', 'Voluntary Term Life'],
        mustNotContain: ['For life-insurance cost, the practical split is:'],
      },
    ],
  },
  {
    id: 'V2-TX-096D',
    category: 'life_employer_guidance_split_adjustment_followups',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
    },
    turns: [
      {
        user: 'what split do you recommend between whole life and voluntary term life?',
        mustContain: ['80% Voluntary Term Life / 20% Whole Life'],
      },
      {
        user: 'how do i know how much of each to get?',
        mustContain: ['80% Voluntary Term Life / 20% Whole Life', 'more Unum Voluntary Term Life', 'more Allstate Whole Life'],
        mustNotContain: ['life insurance is usually worth tightening up'],
      },
      {
        user: 'when would i want more whole life?',
        mustContain: ['of the mix toward', 'Whole Life', 'cash-value'],
        mustNotContain: ['life insurance is usually worth tightening up'],
      },
    ],
  },
  {
    id: 'V2-TX-096E',
    category: 'life_employer_guidance_split_both_wording',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
    },
    turns: [
      {
        user: 'do i need both voluntary term life and whole life?',
        mustContain: ['80% Voluntary Term Life / 20% Whole Life', 'Basic Life', 'Voluntary Term Life', 'Whole Life'],
        mustNotContain: ['life insurance is usually worth tightening up'],
      },
    ],
  },
  {
    id: 'V2-TX-096B',
    category: 'active_topic_contextual_fallbacks',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'HSA/FSA',
      lastBotMessage: 'Here is the simplest way to think about HSA versus FSA fit:',
    },
    turns: [
      {
        user: 'what else?',
        mustContain: ['most useful next step is usually **medical**'],
        mustNotContain: ['Please ask that one a little more specifically'],
      },
    ],
  },
  {
    id: 'V2-TX-097',
    category: 'therapy_specialist_practical_costs',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      lastBotMessage: 'Here is the practical tradeoff across AmeriVet\'s medical options:',
    },
    turns: [
      {
        user: 'i see a therapist 2x monthly, what will that cost?',
        mustContain: ['Therapy / specialist care', 'Standard HSA', 'Enhanced HSA', 'recurring part of your year'],
        mustNotContain: ['A useful next medical step is usually one of these'],
      },
      {
        user: 'is a therapist a specialist?',
        mustContain: ['Usually yes', 'specialist'],
        mustNotContain: ['A useful next medical step is usually one of these'],
      },
    ],
  },
  {
    id: 'V2-TX-097B',
    category: 'therapy_recurring_usage_recommendation',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'TX',
      dataConfirmed: true,
      currentTopic: 'Medical',
      lastBotMessage: 'Here is the practical tradeoff across AmeriVet\'s medical options:',
    },
    turns: [
      {
        user: 'which plan do you recommend if i see a therapist twice a month?',
        mustContain: ['My recommendation: Enhanced HSA', 'more than minimal usage'],
        mustNotContain: ['Quick clarifier'],
      },
    ],
  },
  {
    id: 'V2-TX-097BA',
    category: 'life_context_therapy_recurring_usage_recommendation',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'TX',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      lastBotMessage: 'Life insurance options:\n\n- Unum Basic Life & AD&D is the employer-paid base life and AD&D benefit\n- Unum Voluntary Term Life is the extra employee-paid term coverage\n- Allstate Whole Life is the permanent option with cash value',
    },
    turns: [
      {
        user: 'which plan do you recommend if i see a therapist twice a month?',
        mustContain: ['My recommendation: Enhanced HSA', 'more than minimal usage'],
        mustNotContain: ['Life insurance options:'],
      },
    ],
  },
  {
    id: 'V2-TX-097C',
    category: 'prescription_recurring_usage_recommendation',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'TX',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Spouse',
      familyDetails: { hasSpouse: true, numChildren: 0 },
      lastBotMessage: 'Here is the practical tradeoff across AmeriVet\'s medical options:',
    },
    turns: [
      {
        user: 'which plan do you recommend if my wife takes 2 prescriptions?',
        mustContain: ['My recommendation: Enhanced HSA', 'more than minimal usage'],
        mustNotContain: ['Quick clarifier'],
      },
    ],
  },
  {
    id: 'V2-TX-097CA',
    category: 'hsa_context_recurring_usage_cost_estimate',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'TX',
      dataConfirmed: true,
      currentTopic: 'HSA/FSA',
      coverageTierLock: 'Employee + Spouse',
      familyDetails: { hasSpouse: true, numChildren: 0 },
      lastBotMessage: 'Here is the simplest way to think about HSA versus FSA fit:',
    },
    turns: [
      {
        user: 'estimate likely costs if my wife sees a specialist every month',
        mustContain: ['Projected Healthcare Costs for Employee + Spouse coverage', 'Enhanced HSA'],
        mustNotContain: ['HSA/FSA overview', 'FSA is usually the cleaner fit'],
      },
    ],
  },
  {
    id: 'V2-TX-097D',
    category: 'specialist_recurring_usage_recommendation',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'TX',
      dataConfirmed: true,
      currentTopic: 'Medical',
      lastBotMessage: 'Here is the practical tradeoff across AmeriVet\'s medical options:',
    },
    turns: [
      {
        user: 'which plan do you recommend if i see a specialist every month?',
        mustContain: ['My recommendation: Enhanced HSA', 'more than minimal usage'],
        mustNotContain: ['Quick clarifier'],
      },
    ],
  },
  {
    id: 'V2-TX-097E',
    category: 'child_therapy_recurring_usage_recommendation',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'TX',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Family',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      lastBotMessage: 'Here is the practical tradeoff across AmeriVet\'s medical options:',
    },
    turns: [
      {
        user: 'which plan do you recommend if my daughter sees a therapist every week?',
        mustContain: ['My recommendation: Enhanced HSA', 'recurring care for a child'],
        mustNotContain: ['Quick clarifier'],
      },
    ],
  },
  {
    id: 'V2-TX-097EA',
    category: 'spouse_specialist_natural_recommendation_wording',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'TX',
      dataConfirmed: true,
      currentTopic: 'HSA/FSA',
      coverageTierLock: 'Employee + Spouse',
      familyDetails: { hasSpouse: true, numChildren: 0 },
      lastBotMessage: 'Here is the simplest way to think about HSA versus FSA fit:',
    },
    turns: [
      {
        user: 'what should we pick if my wife sees a specialist every month?',
        mustContain: ['My recommendation: Enhanced HSA', "your spouse's recurring care"],
        mustNotContain: ['HSA/FSA overview', 'Quick clarifier'],
      },
    ],
  },
  {
    id: 'V2-TX-097EB',
    category: 'child_therapy_natural_recommendation_wording',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'TX',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      coverageTierLock: 'Employee + Family',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      lastBotMessage: 'Life insurance options:\n\n- Unum Basic Life & AD&D is the employer-paid base life and AD&D benefit\n- Unum Voluntary Term Life is the extra employee-paid term coverage\n- Allstate Whole Life is the permanent option with cash value',
    },
    turns: [
      {
        user: 'which medical plan makes the most sense if my son does therapy every week?',
        mustContain: ['My recommendation: Enhanced HSA', 'recurring care for a child'],
        mustNotContain: ['Life insurance options:', 'Quick clarifier'],
      },
    ],
  },
  {
    id: 'V2-TX-098',
    category: 'hsa_context_declined_back_to_medical_plans',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'HSA/FSA',
      lastBotMessage: 'HSA/FSA overview:',
    },
    turns: [
      {
        user: "i don't really care about hsa fsa stuff yet. i just wanna see the plans",
        mustContain: ['Standard HSA'],
        mustNotContain: ['HSA/FSA overview', 'FSA is usually the more natural pre-tax account'],
      },
    ],
  },
  {
    id: 'V2-TX-099',
    category: 'life_context_pricing_pivot_back_to_medical',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      coverageTierLock: 'Employee + Family',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      lastBotMessage: 'Life insurance options:\n\n- Unum Basic Life & AD&D is the employer-paid base life and AD&D benefit\n- Unum Voluntary Term Life is the extra employee-paid term coverage\n- Allstate Whole Life is the permanent option with cash value',
    },
    turns: [
      {
        user: 'what about just plan pricing?',
        mustContain: ['Standard HSA'],
        mustNotContain: ['Life insurance options:', 'Voluntary Term Life'],
      },
    ],
  },
  {
    id: 'V2-TX-100',
    category: 'rx_context_pricing_pivot_back_to_medical',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Family',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      lastBotMessage: 'For exact prescription tiers or drug-pricing details, I would use Workday as the starting point rather than guess from memory.\n\nIf you want, I can still compare the medical options at a high level for someone who expects ongoing prescriptions.',
    },
    turns: [
      {
        user: 'what about just plan pricing?',
        mustContain: ['Standard HSA'],
        mustNotContain: ['Workday', 'ongoing prescriptions'],
      },
    ],
  },
  {
    id: 'V2-TX-101',
    category: 'hsa_context_employee_spouse_pricing_pivot',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'HSA/FSA',
      coverageTierLock: 'Employee + Spouse',
      familyDetails: { hasSpouse: true, numChildren: 0 },
      lastBotMessage: 'Here is the simplest way to think about HSA versus FSA fit:',
    },
    turns: [
      {
        user: 'show me the employee + spouse premiums',
        mustContain: ['Employee + Spouse coverage', 'Standard HSA'],
        mustNotContain: ['HSA/FSA overview', 'FSA is usually the cleaner fit'],
      },
    ],
  },
  {
    id: 'V2-TX-102',
    category: 'disability_context_family_pricing_pivot',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Disability',
      coverageTierLock: 'Employee + Family',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      lastBotMessage: 'Disability is really paycheck protection.',
    },
    turns: [
      {
        user: 'show me the family prices',
        mustContain: ['Employee + Family coverage', 'Standard HSA'],
        mustNotContain: ['Disability is really paycheck protection'],
      },
    ],
  },
  {
    id: 'V2-TX-102AA',
    category: 'medical_context_deictic_family_pricing_replay',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Medical',
      coverageTierLock: 'Employee + Family',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      lastBotMessage: 'Medical plan options (Employee + Family):\n\n- Standard HSA (BCBSTX): $321.45/month\n- Enhanced HSA (BCBSTX): $412.37/month\n\nWant to compare plans or switch coverage tiers?',
    },
    turns: [
      {
        user: 'what will that cost?',
        mustContain: ['Employee + Family coverage', 'Standard HSA'],
        mustNotContain: ['A useful next medical step is usually one of these'],
      },
    ],
  },
  {
    id: 'V2-TX-102AB',
    category: 'hsa_context_deictic_spouse_pricing_replay',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'HSA/FSA',
      coverageTierLock: 'Employee + Spouse',
      familyDetails: { hasSpouse: true, numChildren: 0 },
      lastBotMessage: 'Medical plan options (Employee + Spouse):\n\n- Standard HSA (BCBSTX): $190.31/month\n- Enhanced HSA (BCBSTX): $275.10/month\n\nWant to compare plans or switch coverage tiers?',
    },
    turns: [
      {
        user: 'how much would that be for my spouse?',
        mustContain: ['Employee + Spouse coverage', 'Standard HSA'],
        mustNotContain: ['HSA/FSA overview', 'FSA is usually the cleaner fit'],
      },
    ],
  },
  {
    id: 'V2-TX-102AC',
    category: 'hsa_context_deictic_plan_replay',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'HSA/FSA',
      coverageTierLock: 'Employee + Spouse',
      familyDetails: { hasSpouse: true, numChildren: 0 },
      lastBotMessage: 'Medical plan options (Employee + Spouse):\n\n- Standard HSA (BCBSTX): $190.31/month\n- Enhanced HSA (BCBSTX): $275.10/month\n\nWant to compare plans or switch coverage tiers?',
    },
    turns: [
      {
        user: 'show me those plans again',
        mustContain: ['Medical plan options (Employee + Spouse)', 'Standard HSA'],
        mustNotContain: ['HSA/FSA overview', 'FSA is usually the cleaner fit'],
      },
    ],
  },
  {
    id: 'V2-TX-102AD',
    category: 'disability_context_deictic_medical_breakdown_replay',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Disability',
      coverageTierLock: 'Employee + Family',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      lastBotMessage: 'Here is the practical tradeoff across AmeriVet\'s medical options.',
    },
    turns: [
      {
        user: 'show me that breakdown again',
        mustContain: ["Here is the practical tradeoff across AmeriVet's medical options", 'Standard HSA'],
        mustNotContain: ['Disability is really paycheck protection'],
      },
    ],
  },
  {
    id: 'V2-TX-102AE',
    category: 'life_context_deictic_medical_pricing_replay',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      coverageTierLock: 'Employee + Family',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      messages: [
        { role: 'assistant', content: 'Medical plan options (Employee + Family):\n\n- Standard HSA (BCBSTX): $321.45/month\n- Enhanced HSA (BCBSTX): $412.37/month\n\nWant to compare plans or switch coverage tiers?' },
        { role: 'user', content: 'can you tell me about life insurance?' },
      ],
      lastBotMessage: 'Life insurance options:\n\n- Unum Basic Life & AD&D is the employer-paid base life and AD&D benefit\n- Unum Voluntary Term Life is the extra employee-paid term coverage\n- Allstate Whole Life is the permanent option with cash value',
    },
    turns: [
      {
        user: 'what are those medical premiums again?',
        mustContain: ['Employee + Family coverage', 'Standard HSA'],
        mustNotContain: ['Life insurance options:', 'Voluntary Term Life'],
      },
    ],
  },
  {
    id: 'V2-TX-102AF',
    category: 'disability_context_history_based_plan_price_replay',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Disability',
      coverageTierLock: 'Employee + Family',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      messages: [
        { role: 'assistant', content: 'Medical plan options (Employee + Family):\n\n- Standard HSA (BCBSTX): $321.45/month\n- Enhanced HSA (BCBSTX): $412.37/month\n\nWant to compare plans or switch coverage tiers?' },
        { role: 'user', content: 'what about disability?' },
      ],
      lastBotMessage: 'Disability is really paycheck protection.',
    },
    turns: [
      {
        user: 'can i just see those plan prices again?',
        mustContain: ['Employee + Family coverage', 'Standard HSA'],
        mustNotContain: ['Disability is really paycheck protection'],
      },
    ],
  },
  {
    id: 'V2-TX-102A',
    category: 'hsa_context_natural_family_pricing_pivot',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'HSA/FSA',
      coverageTierLock: 'Employee Only',
      familyDetails: { hasSpouse: false, numChildren: 0 },
      lastBotMessage: 'Here is the simplest way to think about HSA versus FSA fit:',
    },
    turns: [
      {
        user: 'what would i pay to cover me, my wife, and my kids?',
        mustContain: ['Employee + Family coverage', 'Standard HSA'],
        mustNotContain: ['HSA/FSA overview', 'FSA is usually the cleaner fit'],
      },
    ],
  },
  {
    id: 'V2-TX-102B',
    category: 'hsa_context_medical_compare_pivot',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'HSA/FSA',
      coverageTierLock: 'Employee Only',
      lastBotMessage: 'Here is the simplest way to think about HSA versus FSA fit:',
    },
    turns: [
      {
        user: 'compare standard hsa with kaiser please',
        mustContain: ['Standard HSA', 'Kaiser Standard HMO'],
        mustNotContain: ['HSA/FSA overview', 'FSA is usually the cleaner fit'],
      },
    ],
  },
  {
    id: 'V2-TX-102C',
    category: 'life_context_medical_prices_again_pivot',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Life Insurance',
      coverageTierLock: 'Employee + Family',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      lastBotMessage: 'Life insurance options:\n\n- Unum Basic Life & AD&D is the employer-paid base life and AD&D benefit\n- Unum Voluntary Term Life is the extra employee-paid term coverage\n- Allstate Whole Life is the permanent option with cash value',
    },
    turns: [
      {
        user: 'what are the medical plan prices again?',
        mustContain: ['Employee + Family coverage', 'Standard HSA'],
        mustNotContain: ['Life insurance options:', 'Voluntary Term Life'],
      },
    ],
  },
  {
    id: 'V2-TX-102D',
    category: 'disability_context_natural_family_medical_pricing_pivot',
    initialSession: {
      step: 'active_chat',
      userName: 'Ted',
      hasCollectedName: true,
      userAge: 28,
      userState: 'WA',
      dataConfirmed: true,
      currentTopic: 'Disability',
      coverageTierLock: 'Employee + Family',
      familyDetails: { hasSpouse: true, numChildren: 2 },
      lastBotMessage: 'Disability is really paycheck protection.',
    },
    turns: [
      {
        user: 'how much are the family medical plans?',
        mustContain: ['Employee + Family coverage', 'Standard HSA'],
        mustNotContain: ['Disability is really paycheck protection'],
      },
    ],
  },
];
