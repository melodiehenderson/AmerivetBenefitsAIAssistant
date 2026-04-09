'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { marked } from 'marked';
import { WelcomeVideoModal } from '@/components/welcome-video-modal';
import { Textarea } from '@/components/ui/textarea';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

function ChatPageContent() {
  const searchParams = useSearchParams();
  const [message, setMessage] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [showSuggestions, setShowSuggestions] = React.useState(true);
  const [showPersonalize, setShowPersonalize] = React.useState(false);
  const [householdSize, setHouseholdSize] = React.useState<'Individual' | 'Couple' | 'Family of 3' | 'Family of 4+'>('Individual');
  const [usageLevel, setUsageLevel] = React.useState<'Low' | 'Moderate' | 'High'>('Moderate');
  const [providerPreference, setProviderPreference] = React.useState<'Any' | 'Kaiser' | 'PPO Network'>('Any');
  const [isMounted, setIsMounted] = React.useState(false);
  const [attachedFiles, setAttachedFiles] = React.useState<File[]>([]);
  const abortRef = React.useRef<AbortController | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const [sessionId] = React.useState(() => `local-chat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  const [cachedContext, setCachedContext] = React.useState<{
    userName?: string;
    userAge?: number;
    userState?: string;
    hasCollectedName?: boolean;
    disclaimerShown?: boolean;
    currentTopic?: string;
    askedForDemographics?: boolean;
    selectedPlan?: string;
    noPricingMode?: boolean;
    coverageTierLock?: string | null;
    dataConfirmed?: boolean;
  } | null>(null);

  React.useEffect(() => {
    setIsMounted(true);
  }, []);

  // Show welcome video modal only once per user
  React.useEffect(() => {
    const hasWatched = searchParams?.get('watched');
    if (!hasWatched) {
      // Show welcome video modal
      setShowPersonalize(true);
    }
  }, [searchParams]);

  // Seed chat and open personalization from URL (e.g., /chat?seed=...&personalize=true)
  React.useEffect(() => {
    const seed = searchParams?.get('seed');
    const personalize = searchParams?.get('personalize');
    if (seed && !isSubmitting && messages.length === 0) {
      // Submit seeded message once on load
      submit(seed);
    }
    if (personalize === 'true') {
      setShowPersonalize(true);
    }
  }, [searchParams]);

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

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length > 0) {
      setAttachedFiles(prev => [...prev, ...files]);
      // Show a user-facing helper about Document Analysis use case
      if (messages.length === 0) {
        const fileList = files
          .map((f) => `• ${f.name} (${(f.size / 1024).toFixed(1)} KB)`) 
          .join('\n');
        const fileMessage: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `📎 Document Analysis\n\nUpload your spouse’s plan or other benefits docs to compare options and find the best fit for your household.\n\nI’ve received ${files.length} file(s):\n${fileList}`,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, fileMessage]);
      }
    }
  };

  const removeFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  async function submit(msg: string) {
    if (!msg.trim() || isSubmitting) return;
    
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: msg,
      timestamp: new Date()
    };
    
    setMessages(prev => [...prev, userMessage]);
    setIsSubmitting(true);
    setShowSuggestions(false);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/qa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: msg,
          sessionId,
          companyId: 'amerivet',
          userId: `local-user-${sessionId.split('-').pop()}`,
          context: cachedContext,
        }),
        signal: controller.signal,
      });

      if (res.ok) {
        const data = await res.json();
        if (data.sessionContext) {
          setCachedContext((prev) => ({
            ...prev,
            ...data.sessionContext,
          }));
        }
        const assistantMessage: Message = {
          id: data.message?.id || crypto.randomUUID(),
          role: 'assistant',
          content: data.answer || data.response || 'I received your message but couldn\'t generate a grounded response.',
          timestamp: new Date(data.message?.timestamp || Date.now())
        };
        setMessages(prev => [...prev, assistantMessage]);
      } else {
        const data = await res.json().catch(() => null);
        const errorMessage: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: data?.error || 'Sorry, I encountered an error while reaching the QA service.',
          timestamp: new Date()
        };
        setMessages(prev => [...prev, errorMessage]);
      }
    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Sorry, I encountered an error while reaching the QA service.',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
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
    <div className="flex flex-col h-screen">
      <WelcomeVideoModal />
      {/* Chat Header */}
      <div className="border-b p-4 bg-white shrink-0">
        <div className="flex items-center space-x-3">
          <Image
            src="/brand/amerivet-logo.png"
            alt="AmeriVet Logo"
            width={32}
            height={32}
            className="object-contain size-8"
            priority
          />
          <div>
            <h1 className="text-xl font-semibold text-gray-900">AmeriVet Benefits AI Assistant</h1>
            <p className="text-sm text-gray-600">Ask me anything about your AmeriVet benefits!</p>
          </div>
        </div>
      </div>
      {/* Main layout with left rail */}
      <div className="flex-1 flex min-h-0">
        {/* Left rail - Suggested Scenarios */}
        <aside className="hidden lg:block w-80 border-r bg-gray-50 shrink-0 overflow-y-auto">
          <div className="p-4">
            <h2 className="text-sm font-semibold text-gray-800 mb-3">Suggested Scenarios</h2>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                className="border rounded px-3 py-2 text-xs hover:bg-gray-100"
                onClick={() => setShowPersonalize(true)}
              >
                🎯 Personalize
              </button>
              <button
                type="button"
                className="border rounded px-3 py-2 text-xs hover:bg-gray-100"
                onClick={() => { window.location.assign('/benefits/compare'); }}
              >
                📊 Open Medical Plan Cost Comparison Tool
              </button>
            </div>
            <div className="space-y-2">
              {[
                { id: 'scen-compare', title: 'Compare PPO vs HSA', sub: 'Family of 4, moderate usage', prompt: 'Compare PPO vs HSA for a family of 4 with moderate usage. Include premiums, deductible, out-of-pocket, and total annual cost.' },
                { id: 'scen-cost', title: 'Estimate annual cost', sub: '3 doctor visits, 2 prescriptions', prompt: 'Estimate my annual healthcare cost with 3 doctor visits and 2 monthly prescriptions on each plan.' },
                { id: 'scen-eligibility', title: 'Check eligibility', sub: 'AmeriVet rules', prompt: 'Am I eligible for benefits? I work 32 hours per week and was hired this month. When is coverage effective?' },
                { id: 'scen-docs', title: 'Analyze spouse plan', sub: 'Upload & compare', prompt: 'I will upload my spouse’s benefits PDF. Compare our options and recommend the best household setup.' },
              ].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="w-full text-left border rounded-lg px-4 py-3 hover:bg-gray-100 transition-colors"
                  onClick={() => submit(s.prompt)}
                >
                  <div className="font-medium text-gray-900">{s.title}</div>
                  <div className="text-xs text-gray-600">{s.sub}</div>
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* Chat column */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
            {messages.length === 0 && showSuggestions && (
              <div className="text-center py-8">
                <h2 className="text-lg font-medium mb-4">Welcome to your AmeriVet Benefits Assistant!</h2>
                <p className="text-gray-600 mb-6">I can help you with questions about your AmeriVet benefits, insurance plans, and more.</p>
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
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] px-4 py-2 rounded-lg ${
                    msg.role === 'user'
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-100 text-gray-900'
                  }`}
                >
                  <div 
                    className="text-sm prose prose-sm max-w-none whitespace-pre-wrap break-words overflow-hidden"
                    style={{ 
                      wordWrap: 'break-word',
                      overflowWrap: 'break-word',
                      hyphens: 'auto'
                    }}
                    dangerouslySetInnerHTML={{ 
                      __html: marked(msg.content, { breaks: true }) 
                    }}
                  />
                  <div className={`text-xs mt-1 ${
                    msg.role === 'user' ? 'text-blue-100' : 'text-gray-500'
                  }`}>
                    {isMounted ? msg.timestamp.toLocaleTimeString() : '--:--'}
                  </div>
                </div>
              </div>
            ))}

            {isSubmitting && (
              <div className="flex justify-start">
                <div className="bg-gray-100 text-gray-900 px-4 py-2 rounded-lg">
                  <div className="flex items-center space-x-2">
                    <div className="animate-spin rounded-full size-4 border-b-2 border-gray-600"></div>
                    <span className="text-sm">Thinking...</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Attached Files Display */}
          {attachedFiles.length > 0 && (
            <div className="border-t bg-gray-50 p-3">
              <div className="flex flex-wrap gap-2">
                {attachedFiles.map((file, index) => (
                  <div key={`${file.name}-${file.size}-${index}`} className="flex items-center gap-2 bg-white border rounded px-3 py-2 text-sm">
                    <span className="text-blue-500">📎</span>
                    <span className="text-gray-700">{file.name}</span>
                    <button
                      onClick={() => removeFile(index)}
                      className="text-red-500 hover:text-red-700 ml-1"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Input Area */}
          <div className="border-t p-4 shrink-0">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="border rounded px-3 py-2 text-sm hover:bg-gray-50"
                onClick={() => fileInputRef.current?.click()}
              >
                📎 Attach
              </button>
              <input 
                ref={fileInputRef} 
                type="file" 
                hidden 
                multiple
                accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
                onChange={handleFileUpload}
              />

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
      </div>
      {/* Personalization Overlay */}
      {showPersonalize && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setShowPersonalize(false)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setShowPersonalize(false);
            }}
            tabIndex={-1}
            aria-hidden="true"
          />
          <div className="relative bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 p-6">
            <h3 className="text-lg font-semibold mb-1">Personalize your recommendations</h3>
            <p className="text-sm text-gray-600 mb-4">Answer 3 quick questions to tailor suggested prompts and plan comparisons.</p>
            <div className="space-y-4">
              <div>
                <label htmlFor="householdSize" className="block text-sm font-medium text-gray-700">Household size</label>
                <select
                  id="householdSize"
                  className="mt-1 w-full rounded border p-2"
                  value={householdSize}
                  onChange={(e) => setHouseholdSize(e.target.value as any)}
                >
                  <option>Individual</option>
                  <option>Couple</option>
                  <option>Family of 3</option>
                  <option>Family of 4+</option>
                </select>
              </div>
              <div>
                <label htmlFor="usageLevel" className="block text-sm font-medium text-gray-700">Usage level</label>
                <select
                  id="usageLevel"
                  className="mt-1 w-full rounded border p-2"
                  value={usageLevel}
                  onChange={(e) => setUsageLevel(e.target.value as any)}
                >
                  <option>Low</option>
                  <option>Moderate</option>
                  <option>High</option>
                </select>
              </div>
              <div>
                <label htmlFor="providerPreference" className="block text-sm font-medium text-gray-700">Provider preference</label>
                <select
                  id="providerPreference"
                  className="mt-1 w-full rounded border p-2"
                  value={providerPreference}
                  onChange={(e) => setProviderPreference(e.target.value as any)}
                >
                  <option>Any</option>
                  <option>Kaiser</option>
                  <option>PPO Network</option>
                </select>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className="border rounded px-4 py-2 text-sm hover:bg-gray-50"
                onClick={() => setShowPersonalize(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="bg-blue-600 text-white rounded px-4 py-2 text-sm hover:bg-blue-700"
                onClick={() => {
                  const prompt = `Personalize my benefits guidance. Household: ${householdSize}. Usage: ${usageLevel}. Provider preference: ${providerPreference}. Suggest the best starting questions and which plans to compare.`;
                  setShowPersonalize(false);
                  submit(prompt);
                }}
              >
                Start with tailored prompts
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Export as dynamic component to prevent SSR hydration issues
const ChatPage = dynamic(() => Promise.resolve(ChatPageContent), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-screen">
      <div className="text-center">
        <div className="animate-spin rounded-full size-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p>Loading chat...</p>
      </div>
    </div>
  )
});

export default ChatPage;
