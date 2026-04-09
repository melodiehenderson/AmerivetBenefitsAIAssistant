"use client";

import { FormEvent, useMemo, useState } from 'react';
import { Markdown } from '@/components/markdown';

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

export default function LocalPreviewPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [state, setState] = useState('TX');
  const [age, setAge] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const history = useMemo(() => messages.slice(-8), [messages]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = input.trim();
    if (trimmed.length === 0 || isLoading) return;

    const nextMessages = [...messages, { role: 'user' as const, content: trimmed }];
    setMessages(nextMessages);
    setInput('');
    setIsLoading(true);
    setError('');

    try {
      const response = await fetch('/api/local-preview-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          history,
          state: state || undefined,
          userAge: age ? Number(age) : undefined,
        }),
      });

      const data = await response.json();
      if (response.ok === false) {
        throw new Error(data.error || 'Request failed');
      }

      setMessages((current) => [...current, { role: 'assistant', content: data.content }]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Request failed';
      setError(message);
      setMessages((current) => [
        ...current,
        { role: 'assistant', content: 'Preview error: ' + message },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        background: '#f5f7fb',
        padding: '32px 20px',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ maxWidth: 1100, margin: '0 auto', display: 'grid', gap: 20 }}>
        <section
          style={{
            background: '#fff',
            border: '1px solid #d8e0ef',
            borderRadius: 16,
            padding: 24,
          }}
        >
          <h1 style={{ margin: 0, fontSize: 32 }}>AmeriVet Local Preview</h1>
          <p style={{ margin: '12px 0 0', color: '#51607a' }}>
            This preview bypasses the flaky app shell. In local mode, it uses a small
            repo-backed plan catalog so we can test no-guessing behavior, clarify-first
            fallback wording, and markdown tables even without the original developer&apos;s
            Azure setup.
          </p>
        </section>

        <section
          style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20, alignItems: 'start' }}
        >
          <aside
            style={{
              background: '#fff',
              border: '1px solid #d8e0ef',
              borderRadius: 16,
              padding: 20,
              display: 'grid',
              gap: 14,
            }}
          >
            <div>
              <label htmlFor="state" style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>
                State
              </label>
              <input
                id="state"
                value={state}
                onChange={(e) => setState(e.target.value.toUpperCase())}
                style={{
                  width: '100%',
                  padding: 10,
                  borderRadius: 10,
                  border: '1px solid #c8d3e6',
                }}
              />
            </div>
            <div>
              <label htmlFor="age" style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>
                Age
              </label>
              <input
                id="age"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                placeholder="Optional"
                style={{
                  width: '100%',
                  padding: 10,
                  borderRadius: 10,
                  border: '1px solid #c8d3e6',
                }}
              />
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              <button
                type="button"
                onClick={() => setInput('Does AmeriVet offer a gold PPO with Rightway support?')}
                style={quickButtonStyle}
              >
                Ungrounded test
              </button>
              <button
                type="button"
                onClick={() => setInput('What medical plans are available in Texas?')}
                style={quickButtonStyle}
              >
                Grounded medical test
              </button>
              <button
                type="button"
                onClick={() => setInput('Compare the medical plans in Texas in a table.')}
                style={quickButtonStyle}
              >
                Table rendering test
              </button>
            </div>
          </aside>

          <section
            style={{
              background: '#fff',
              border: '1px solid #d8e0ef',
              borderRadius: 16,
              padding: 20,
              minHeight: 620,
              display: 'grid',
              gridTemplateRows: '1fr auto',
              gap: 16,
            }}
          >
            <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
              {messages.length === 0 ? (
                <div style={{ color: '#51607a' }}>No messages yet. Pick a test prompt or type your own.</div>
              ) : (
                messages.map((message, index) => (
                  <div
                    key={message.role + '-' + String(index)}
                    style={{
                      justifySelf: message.role === 'user' ? 'end' : 'stretch',
                      background: message.role === 'user' ? '#1f5eff' : '#f4f7fc',
                      color: message.role === 'user' ? '#fff' : '#162033',
                      padding: '14px 16px',
                      borderRadius: 14,
                      maxWidth: message.role === 'user' ? '75%' : '100%',
                      overflowX: 'auto',
                    }}
                  >
                    <Markdown>{message.content}</Markdown>
                  </div>
                ))
              )}
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12 }}>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask a benefits question..."
                rows={4}
                style={{
                  width: '100%',
                  padding: 14,
                  borderRadius: 14,
                  border: '1px solid #c8d3e6',
                  resize: 'vertical',
                }}
              />
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <div style={{ color: error ? '#b42318' : '#51607a', fontSize: 14 }}>
                  {error || 'Testing grounded answers only.'}
                </div>
                <button
                  type="submit"
                  disabled={isLoading || input.trim().length === 0}
                  style={{ ...sendButtonStyle, opacity: isLoading || input.trim().length === 0 ? 0.6 : 1 }}
                >
                  {isLoading ? 'Checking...' : 'Send'}
                </button>
              </div>
            </form>
          </section>
        </section>
      </div>
    </main>
  );
}

const quickButtonStyle: React.CSSProperties = {
  background: '#eef4ff',
  border: '1px solid #c8d3e6',
  borderRadius: 12,
  padding: '10px 12px',
  textAlign: 'left',
  cursor: 'pointer',
};

const sendButtonStyle: React.CSSProperties = {
  background: '#1f5eff',
  color: '#fff',
  border: 'none',
  borderRadius: 12,
  padding: '10px 18px',
  cursor: 'pointer',
  fontWeight: 600,
};
