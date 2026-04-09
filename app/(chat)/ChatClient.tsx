'use client';

import * as React from 'react';
import { marked } from 'marked';
import { WelcomeVideoModal } from '@/components/welcome-video-modal';
import { Textarea } from '@/components/ui/textarea';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export default function ChatClient() {
  const [message, setMessage] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [showSuggestions, setShowSuggestions] = React.useState(true);
  const [isMounted, setIsMounted] = React.useState(false);
  const [initialQuestionsAnswered, setInitialQuestionsAnswered] = React.useState(false);
  const [nameInput, setNameInput] = React.useState('');
  const [stateInput, setStateInput] = React.useState('');
  const [divisionInput, setDivisionInput] = React.useState('');
  const [currentQuestion, setCurrentQuestion] = React.useState<'name' | 'state' | 'division' | null>('name');
  const abortRef = React.useRef<AbortController | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setIsMounted(true);
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  React.useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const TEXTAREA_MIN_HEIGHT = 96;
  const TEXTAREA_MAX_HEIGHT = 200;

  const syncTextareaHeight = React.useCallback(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = 'auto';
    const nextHeight = Math.min(textareaRef.current.scrollHeight + 2, TEXTAREA_MAX_HEIGHT);
    textareaRef.current.style.height = `${Math.max(nextHeight, TEXTAREA_MIN_HEIGHT)}px`;
  }, []);

  React.useEffect(() => {
    syncTextareaHeight();
  }, [message, syncTextareaHeight]);

  async function submit(msg: string) {
    if (!msg.trim() || isSubmitting) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: msg,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsSubmitting(true);
    setShowSuggestions(false);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/chat-demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
        signal: controller.signal,
      });

      if (res.ok) {
        const data = await res.json();
        const assistantMessage: Message = {
          id: data.message?.id || crypto.randomUUID(),
          role: 'assistant',
          content:
            data.message?.content ||
            "I received your message but couldn't generate a response. This is demo mode - the full AI integration will be available in production.",
          timestamp: new Date(data.message?.timestamp || Date.now()),
        };
        setMessages((prev) => [...prev, assistantMessage]);
      } else {
        const errorMessage: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content:
            'Sorry, I encountered an error. This is demo mode - the full AI integration will be available in production.',
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, errorMessage]);
      }
    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content:
          'Sorry, I encountered an error. This is demo mode - the full AI integration will be available in production.',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsSubmitting(false);
      abortRef.current = null;
      setMessage('');
    }
  }

  function onStop() {
    abortRef.current?.abort();
    setIsSubmitting(false);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Welcome Video Modal */}
      <WelcomeVideoModal />
      
      {/* Chat Header */}
      <div className="border-b p-4">
        <h1 className="text-xl font-semibold">Benefits AI Assistant</h1>
        <p className="text-sm text-gray-600">Ask me anything about your benefits!</p>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && showSuggestions && (
          <div className="text-center py-8">
            <h2 className="text-lg font-medium mb-4">Welcome to your Benefits Assistant!</h2>
            <p className="text-gray-600 mb-6">I can help you with questions about your benefits, insurance plans, and more.</p>
            <div className="grid gap-3 max-w-md mx-auto">
              <button
                type="button"
                className="border rounded-lg px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                onClick={() => submit('What are the advantages of using a benefits assistant?')}
              >
                <div className="font-medium">What are the advantages of using a benefits assistant?</div>
                <div className="text-sm text-gray-500">Learn about how I can help you</div>
              </button>
              <button
                type="button"
                className="border rounded-lg px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                onClick={() => submit('Compare health insurance plans')}
              >
                <div className="font-medium">Compare health insurance plans</div>
                <div className="text-sm text-gray-500">See available options</div>
              </button>
              <button
                type="button"
                className="border rounded-lg px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                onClick={() => submit('Tell me about HSA benefits')}
              >
                <div className="font-medium">Tell me about HSA benefits</div>
                <div className="text-sm text-gray-500">Health savings account info</div>
              </button>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                msg.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-900'
              }`}
            >
              <div
                className="text-sm prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{
                  __html: marked(msg.content, { breaks: true }) as unknown as string,
                }}
              />
              <div className={`text-xs mt-1 ${msg.role === 'user' ? 'text-blue-100' : 'text-gray-500'}`}>
                {isMounted ? msg.timestamp.toLocaleTimeString() : '--:--'}
              </div>
            </div>
          </div>
        ))}

        {isSubmitting && (
          <div className="flex justify-start">
            <div className="bg-gray-100 text-gray-900 px-4 py-2 rounded-lg">
              <div className="flex items-center space-x-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600"></div>
                <span className="text-sm">Thinking...</span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="border-t p-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="border rounded px-3 py-2 text-sm hover:bg-gray-50"
            onClick={() => fileInputRef.current?.click()}
          >
            📎 Attach
          </button>
          <input ref={fileInputRef} type="file" hidden onChange={() => {}} />

          <Textarea
            ref={textareaRef}
            className="flex-1 !min-h-[96px] !max-h-[200px] resize-none overflow-y-auto border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Type your message..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            style={{
              minHeight: `${TEXTAREA_MIN_HEIGHT}px`,
              maxHeight: `${TEXTAREA_MAX_HEIGHT}px`,
              overflowY: textareaRef.current && textareaRef.current.scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit(message);
              }
            }}
            disabled={isSubmitting}
          />

          {!isSubmitting ? (
            <button
              type="button"
              className="bg-blue-500 text-white rounded px-4 py-2 hover:bg-blue-600 disabled:opacity-50"
              onClick={() => submit(message)}
              disabled={!message.trim()}
            >
              Send
            </button>
          ) : (
            <button
              type="button"
              className="bg-red-500 text-white rounded px-4 py-2 hover:bg-red-600"
              onClick={onStop}
            >
              Stop
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
