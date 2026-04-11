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
];
