'use client';
import { memo } from 'react';
import type { UseChatHelpers } from '@ai-sdk/react';
import type { VisibilityType } from './visibility-selector';
import type { ChatMessage } from '@/lib/types';
import type { UIMessage } from 'ai';

interface SuggestedActionsProps {
  sendMessage: UseChatHelpers<ChatMessage>['sendMessage'];
  setInput: (input: string) => void;
  messages: Array<UIMessage>;
}

function PureSuggestedActions({
  sendMessage,
  setInput,
  messages,
}: SuggestedActionsProps) {
  const suggestedActions: never[] = [];

  return (
    <div
      data-testid="suggested-actions"
      className="grid sm:grid-cols-2 gap-2 w-full"
    >
      {/* No suggestions to show - benefits quick actions are handled elsewhere */}
    </div>
  );
}

export const SuggestedActions = memo(
  PureSuggestedActions,
  (prevProps, nextProps) => {
    if (prevProps.messages.length !== nextProps.messages.length) return false;
    return true;
  },
);
