export type ChatModel = {
  id: string;
  name: string;
  maxTokens: number;
  costPerToken: number;
  description?: string;
};

export const chatModels: ChatModel[] = [
  {
    id: 'gpt-3.5-turbo',
    name: 'GPT-3.5',
    maxTokens: 16_000,
    costPerToken: 0.000002,
    description: 'Fast & inexpensive for general chat',
  },
  {
    id: 'gpt-4',
    name: 'GPT-4',
    maxTokens: 128_000,
    costPerToken: 0.00001,
    description: 'Higher quality reasoning and longer context',
  },
];

export const DEFAULT_CHAT_MODEL = chatModels[0].id;

export const chatModelMap = Object.fromEntries(chatModels.map(m => [m.id, m]));

export const embeddingModels = {
  'text-embedding-3-large': {
    name: 'Text Embedding 3 Large',
    dimensions: 1536,
    costPerToken: 0.0000001
  }
};

// Model list for UI selection
export const CHAT_MODELS = [
  { id: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
  { id: 'gpt-4', label: 'GPT-4' },
] as const;

export type ChatModelId = typeof CHAT_MODELS[number]['id'];
