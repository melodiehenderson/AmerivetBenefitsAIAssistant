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
];
