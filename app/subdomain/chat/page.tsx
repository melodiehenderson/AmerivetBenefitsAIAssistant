/**
 * Subdomain chat page with AI assistant
 */

'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Send, 
  Bot, 
  User, 
  ArrowLeft,
  Loader2,
  MessageSquare,
  Calculator,
  FileText,
  Users,
  Heart,
  Eye
} from 'lucide-react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface Scenario {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  message: string;
  action?: 'upload' | 'calculator' | 'chat';
}

const SUGGESTED_SCENARIOS: Scenario[] = [
  {
    id: 'hsa-analysis',
    title: 'HSA Plan Analysis',
    description: 'Deep dive into Health Savings Account benefits',
    icon: <Calculator className="h-5 w-5" />,
    message: "I'm generally healthy and take one prescription medication. Should I choose the HSA plan? What are the tax benefits?",
    action: 'chat'
  },
  {
    id: 'kaiser-comparison',
    title: 'Kaiser Plan Comparison',
    description: 'Compare Standard vs Enhanced Kaiser HMO plans',
    icon: <Heart className="h-5 w-5" />,
    message: "Help me compare Kaiser Standard vs Enhanced plans. I have a family of 4 with two young children.",
    action: 'chat'
  },
  {
    id: 'family-coverage',
    title: 'Family Coverage Planning',
    description: 'Plan benefits for your entire family',
    icon: <Users className="h-5 w-5" />,
    message: "I need to understand family coverage options. My spouse works part-time and we have two kids.",
    action: 'chat'
  },
  {
    id: 'dental-vision',
    title: 'Dental & Vision Benefits',
    description: 'Explore dental and vision coverage',
    icon: <Eye className="h-5 w-5" />,
    message: "What dental and vision benefits are available? I need orthodontics for my teenager.",
    action: 'chat'
  },
  {
    id: 'cost-calculator',
    title: 'Personalized Medical Plan Cost Comparison Tool',
    description: 'Calculate total costs based on your situation',
    icon: <Calculator className="h-5 w-5" />,
    message: "Help me calculate total healthcare costs for next year.",
    action: 'calculator'
  }
];

export default function SubdomainChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [selectedScenario, setSelectedScenario] = useState<string | null>(null);
  const [showCalcOverlay, setShowCalcOverlay] = useState(false);
  const [calcPrefs, setCalcPrefs] = useState({ household: 'individual', usage: 'moderate', provider: 'any' });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const quickPrompts = [
    'What is covered under my medical plan?',
    'What is my deductible and out-of-pocket maximum?',
    'How do I add a dependent to my plan?',
    'What is the difference between HSA and FSA?',
    'Can you summarize my dental benefits?',
    'What is the 401(k) employer match?',
  ];
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const checkAuth = async () => {
    try {
      const response = await fetch('/api/subdomain/auth/session', {
        method: 'GET',
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        if (data.ok && data.role) {
          setIsAuthenticated(true);
        }
      }
    } catch (err) {
      console.error('Auth check failed:', err);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      const allowedTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'];
      if (!allowedTypes.includes(file.type)) {
        setError('Please upload a PDF, DOCX, or TXT file');
        return;
      }
      // Validate file size (10MB)
      if (file.size > 10 * 1024 * 1024) {
        setError('File size must be less than 10MB');
        return;
      }
      setSelectedFile(file);
      setError('');
    }
  };

  const handleFileUpload = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('companyId', 'amerivet'); // TODO: Get from subdomain/session

      const response = await fetch('/api/subdomain/documents/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include', // Include session cookie
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Upload failed with status ${response.status}`);
      }

      const result = await response.json();
      
      // Add success message
      const successMessage: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: `✅ Document uploaded successfully! I've analyzed your ${selectedFile.name}. Here's what I found:\n\n${result.summary || 'Document is being processed. You can now ask questions about it!'}`,
        timestamp: new Date(),
      };
      
      setMessages(prev => [...prev, successMessage]);
      setSelectedFile(null);
      
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Upload failed. Please try again.';
      setError(errorMsg);
      console.error('Upload error:', err);
    } finally {
      setIsUploading(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setError('');

    try {
      const response = await fetch('/api/qa', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          query: userMessage.content,
          sessionId: 'subdomain-chat-' + Date.now(), // FIX: Must use sessionId (not conversationId)
          companyId: 'amerivet', // FIX: Explicitly set company ID to match indexed documents
          userId: 'user-' + Date.now(), // Track user for personalization
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      const data = await response.json();
      
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.answer || data.response || 'I apologize, but I couldn\'t process your request. Please try again.',
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'I apologize, but I\'m having trouble processing your request right now. Please try again later.',
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const runScenario = (scenario: Scenario) => {
    setSelectedScenario(scenario.id);
    
    if (scenario.action === 'calculator') {
      setShowCalcOverlay(true);
      return;
    }
    
    // Regular chat scenario
    setInput(scenario.message);
    const fakeEvent = { preventDefault: () => {} } as unknown as React.FormEvent;
    setTimeout(() => handleSendMessage(fakeEvent), 0);
  };

  const submitCalculatorPrefs = () => {
    setShowCalcOverlay(false);
    const personalizedPrompt = `Help me calculate healthcare costs for next year. My household is ${calcPrefs.household}, usage level is ${calcPrefs.usage}, and I prefer ${calcPrefs.provider === 'any' ? 'any provider' : calcPrefs.provider + ' network'}. Please recommend plans and estimate costs.`;
    setInput(personalizedPrompt);
    const fakeEvent = { preventDefault: () => {} } as unknown as React.FormEvent;
    setTimeout(() => handleSendMessage(fakeEvent), 0);
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Alert variant="destructive" className="max-w-md">
          <AlertDescription>Please log in to access the chat.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white dark:bg-gray-900 dark:border-gray-800 shadow-sm border-b">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center h-16">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push('/subdomain/dashboard')}
              className="mr-4"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Dashboard
            </Button>
            <div className="flex items-center">
              <MessageSquare className="w-6 h-6 text-blue-600 mr-3" />
              <h1 className="text-lg font-semibold text-gray-900">
                Benefits Assistant Chat
              </h1>
            </div>
          </div>
        </div>
      </header>

      {/* Chat Container */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Left Quick Prompts */}
          <aside className="hidden lg:block lg:col-span-1">
            <Card className="h-[calc(100vh-140px)] sticky top-4 overflow-hidden flex flex-col bg-white dark:bg-gray-900 dark:border-gray-800">
              <CardHeader className="pb-3 flex-shrink-0">
                <CardTitle className="text-sm">Suggested Scenarios</CardTitle>
                <CardDescription className="text-xs">Click any scenario to get started</CardDescription>
              </CardHeader>
              <CardContent className="pt-0 flex-1 overflow-y-auto space-y-2">
                {SUGGESTED_SCENARIOS.map((scenario) => (
                  <Button
                    key={scenario.id}
                    variant={selectedScenario === scenario.id ? "default" : "outline"}
                    className="w-full justify-start h-auto p-3 text-left"
                    onClick={() => runScenario(scenario)}
                    disabled={isLoading}
                  >
                    <div className="flex items-start gap-2 w-full">
                      {scenario.icon}
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-xs break-words">{scenario.title}</div>
                        <div className="text-xs opacity-70 mt-0.5 break-words whitespace-normal">
                          {scenario.description}
                        </div>
                      </div>
                    </div>
                  </Button>
                ))}
              </CardContent>
            </Card>
          </aside>

          {/* Chat Column */}
          <div className="lg:col-span-3">
            <Card className="h-[calc(100vh-140px)] flex flex-col bg-white dark:bg-gray-900 dark:border-gray-800">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center">
              <Bot className="w-5 h-5 mr-2 text-blue-600" />
              AI Benefits Assistant
            </CardTitle>
          </CardHeader>
          
          <CardContent className="flex-1 flex flex-col overflow-hidden">
            {/* Messages */}
            <div className="flex-1 overflow-y-auto space-y-4 mb-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-lg px-4 py-2 ${
                      message.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100'
                    }`}
                  >
                    <div className="flex items-start">
                      {message.role === 'assistant' && (
                        <Bot className="w-4 h-4 mr-2 mt-1 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                      )}
                      {message.role === 'user' && (
                        <User className="w-4 h-4 mr-2 mt-1 text-white flex-shrink-0" />
                      )}
                      <div className="flex-1">
                        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                        <p className="text-xs opacity-70 mt-1">
                          {message.timestamp.toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              
              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 rounded-lg px-4 py-2 flex items-center">
                    <Bot className="w-4 h-4 mr-2 text-blue-600" />
                    <Loader2 className="w-4 h-4 animate-spin text-gray-600" />
                    <span className="ml-2 text-sm text-gray-600">Thinking...</span>
                  </div>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>

            {/* Error Display */}
            {error && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Input Form */}
            <form onSubmit={handleSendMessage} className="flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about your benefits..."
                disabled={isLoading}
                className="flex-1"
              />
              <Button type="submit" disabled={isLoading || !input.trim()}>
                <Send className="w-4 h-4" />
              </Button>
            </form>
          </CardContent>
        </Card>
          </div>
        </div>
      </div>

      {/* Calculator Personalization Overlay */}
      {showCalcOverlay && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Personalize Your Cost Estimate</CardTitle>
              <CardDescription>Answer 3 quick questions for tailored recommendations</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Household Size</label>
                <select
                  className="w-full p-2 border rounded"
                  value={calcPrefs.household}
                  onChange={(e) => setCalcPrefs({...calcPrefs, household: e.target.value})}
                >
                  <option value="individual">Individual</option>
                  <option value="couple">Couple</option>
                  <option value="family3">Family of 3</option>
                  <option value="family4+">Family of 4+</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Usage Level</label>
                <select
                  className="w-full p-2 border rounded"
                  value={calcPrefs.usage}
                  onChange={(e) => setCalcPrefs({...calcPrefs, usage: e.target.value})}
                >
                  <option value="low">Low (1-2 visits/year)</option>
                  <option value="moderate">Moderate (3-6 visits/year)</option>
                  <option value="high">High (7+ visits/year)</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Provider Preference</label>
                <select
                  className="w-full p-2 border rounded"
                  value={calcPrefs.provider}
                  onChange={(e) => setCalcPrefs({...calcPrefs, provider: e.target.value})}
                >
                  <option value="any">Any Provider</option>
                  <option value="kaiser">Kaiser</option>
                  <option value="ppo">PPO Network</option>
                </select>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setShowCalcOverlay(false)}>Cancel</Button>
                <Button className="flex-1" onClick={submitCalculatorPrefs}>Get Recommendations</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

