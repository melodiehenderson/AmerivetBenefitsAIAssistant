'use client';

import { useState } from 'react';
import { getAmerivetPackageCopySnapshot } from '@/lib/data/amerivet-package-copy';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Send, FileText, Calculator, Users, Shield, Eye, Heart } from 'lucide-react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

const ACTIVE_AMERIVET_COPY = getAmerivetPackageCopySnapshot();
const MEDICAL_PLAN_LIST = ACTIVE_AMERIVET_COPY.medicalPlanNames.join(', ');

const DEMO_SCENARIOS = [
  {
    id: 'hsa-analysis',
    title: 'HSA Plan Analysis',
    description: 'Deep dive into Health Savings Account benefits and tax advantages',
    icon: <Calculator className="h-5 w-5" />,
    message: 'I\'m 28, single, and generally healthy. I take one prescription medication monthly. Should I choose the HSA plan? What are the tax benefits and how much should I contribute?'
  },
  {
    id: 'kaiser-comparison',
    title: 'Medical Plan Comparison',
    description: 'Compare the available medical plan options',
    icon: <Heart className="h-5 w-5" />,
    message: `I need help comparing the available medical plans: ${MEDICAL_PLAN_LIST}. I have a family of 4 with two young children. We visit the doctor about 6-8 times per year and my wife takes regular medications.`
  },
  {
    id: 'document-analysis',
    title: 'Benefits Document Analysis',
    description: 'Upload and analyze your benefits documents',
    icon: <FileText className="h-5 w-5" />,
    message: 'I\'ve attached my benefits summary document. Can you analyze it and tell me what plans are available, what the costs are, and which one would be best for my situation?'
  },
  {
    id: 'family-coverage',
    title: 'Family Coverage Planning',
    description: 'Plan benefits for your entire family',
    icon: <Users className="h-5 w-5" />,
    message: 'I need to understand family coverage options. My spouse works part-time and we have two kids (ages 5 and 8). What are the costs for adding them to my plan vs getting separate coverage?'
  },
  {
    id: 'dental-vision',
    title: 'Dental & Vision Benefits',
    description: 'Explore dental and vision coverage options',
    icon: <Eye className="h-5 w-5" />,
    message: 'What dental and vision benefits are available? I need orthodontics for my teenager and my spouse needs new glasses every year. What\'s covered and what are the costs?'
  },
  {
    id: 'cost-calculator',
    title: 'Total Medical Plan Cost Comparison Tool',
    description: 'Calculate total annual healthcare costs',
    icon: <Calculator className="h-5 w-5" />,
    message: 'Help me calculate the total cost of healthcare for next year. I want to compare all available plans including premiums, deductibles, copays, and out-of-pocket maximums. I typically have 2-3 doctor visits and 1 specialist visit per year.'
  }
];

export default function DemoPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedScenario, setSelectedScenario] = useState<string | null>(null);

  const sendMessage = async (message: string) => {
    if (!message.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: message,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat-demo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message }),
      });

      const data = await response.json();
      
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.content,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const runScenario = (scenario: typeof DEMO_SCENARIOS[0]) => {
    setSelectedScenario(scenario.id);
    setInputMessage(scenario.message);
    sendMessage(scenario.message);
  };

  const clearChat = () => {
    setMessages([]);
    setSelectedScenario(null);
    setInputMessage('');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            🤖 AmeriVet Benefits AI Demo
          </h1>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            Experience the power of AI-driven benefits assistance. Ask questions, upload documents, 
            and get personalized recommendations powered by Azure OpenAI.
          </p>
          <div className="flex justify-center gap-4 mt-6">
            <Badge variant="secondary" className="px-4 py-2">
              <Shield className="h-4 w-4 mr-2" />
              Azure OpenAI Powered
            </Badge>
            <Badge variant="secondary" className="px-4 py-2">
              <FileText className="h-4 w-4 mr-2" />
              Document Analysis
            </Badge>
            <Badge variant="secondary" className="px-4 py-2">
              <Calculator className="h-4 w-4 mr-2" />
              Medical Plan Cost Comparison Tool
            </Badge>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Demo Scenarios */}
          <div className="lg:col-span-1">
            <Card className="h-[700px] flex flex-col">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Demo Scenarios
                </CardTitle>
                <CardDescription>
                  Click any scenario to see the AI in action
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col min-h-0">
                <div className="space-y-3 flex-1 overflow-y-auto">
                {DEMO_SCENARIOS.map((scenario) => (
                  <Button
                    key={scenario.id}
                    variant={selectedScenario === scenario.id ? "default" : "outline"}
                    className="w-full justify-start h-auto p-4"
                    onClick={() => runScenario(scenario)}
                  >
                    <div className="flex items-start gap-3 w-full">
                      {scenario.icon}
                      <div className="text-left flex-1 min-w-0">
                        <div className="font-semibold break-words">{scenario.title}</div>
                        <div className="text-sm opacity-70 mt-1 break-words whitespace-normal">
                          {scenario.description}
                        </div>
                      </div>
                    </div>
                  </Button>
                ))}
                </div>
                
                <div className="pt-4 border-t mt-4 flex-shrink-0">
                  <Button
                    variant="outline"
                    onClick={clearChat}
                    className="w-full"
                  >
                    Clear Chat
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Chat Interface */}
          <div className="lg:col-span-2">
            <Card className="h-[700px] flex flex-col">
              <CardHeader>
                <CardTitle>AI Benefits Assistant</CardTitle>
                <CardDescription>
                  Ask questions about your benefits, upload documents, or try a demo scenario
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col min-h-0">
                {/* Messages */}
                <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2">
                  {messages.length === 0 && (
                    <div className="text-center text-gray-500 py-8">
                      <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>Select a demo scenario or ask a question to get started</p>
                    </div>
                  )}
                  
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-lg p-4 ${
                          message.role === 'user'
                            ? 'bg-blue-500 text-white'
                            : 'bg-gray-100 text-gray-900'
                        }`}
                      >
              <div 
                className="whitespace-pre-wrap break-words text-sm leading-relaxed overflow-hidden"
                style={{ 
                  wordWrap: 'break-word',
                  overflowWrap: 'break-word',
                  hyphens: 'auto'
                }}
              >
                {message.content}
              </div>
                        <div className={`text-xs mt-2 ${
                          message.role === 'user' ? 'text-blue-100' : 'text-gray-500'
                        }`}>
                          {message.timestamp.toLocaleTimeString()}
                        </div>
                      </div>
                    </div>
                  ))}
                  
                  {isLoading && (
                    <div className="flex justify-start">
                      <div className="bg-gray-100 rounded-lg p-4">
                        <div className="flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>AI is thinking...</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Input */}
                <div className="flex gap-2">
                  <Input
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    placeholder="Ask about your benefits..."
                    onKeyPress={(e) => e.key === 'Enter' && sendMessage(inputMessage)}
                    disabled={isLoading}
                  />
                  <Button
                    onClick={() => sendMessage(inputMessage)}
                    disabled={isLoading || !inputMessage.trim()}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Features Showcase */}
        <div className="mt-12">
          <h2 className="text-2xl font-bold text-center mb-8">AI-Powered Features</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card 
              className="cursor-pointer hover:shadow-lg transition-shadow duration-200 hover:scale-105"
              onClick={() => window.location.assign('/chat')}
            >
              <CardHeader>
                <div className="flex items-center gap-2">
                  <FileText className="h-6 w-6 text-blue-500" />
                  <CardTitle>Document Analysis</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600">
                  Upload your spouse’s plan or other benefits docs to compare options and find the best fit for your household.
                </p>
                <div className="mt-3 text-sm text-blue-600 font-medium">
                  Click to start uploading →
                </div>
              </CardContent>
            </Card>
            
            <Card 
              className="cursor-pointer hover:shadow-lg transition-shadow duration-200 hover:scale-105"
              onClick={() => window.location.assign('/benefits/compare')}
            >
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Calculator className="h-6 w-6 text-green-500" />
                  <CardTitle>Medical Plan Cost Comparison Tool</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600">
                  Compare total annual costs across all plans including premiums, deductibles, and out-of-pocket expenses.
                </p>
                <div className="mt-3 text-sm text-green-600 font-medium">
                  Click to open calculator →
                </div>
              </CardContent>
            </Card>
            
            <Card 
              className="cursor-pointer hover:shadow-lg transition-shadow duration-200 hover:scale-105"
              onClick={() => window.location.assign('/chat?personalize=true')}
            >
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Users className="h-6 w-6 text-purple-500" />
                  <CardTitle>Personalized Recommendations</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600">
                  Get tailored advice based on your health needs, family situation, and budget preferences.
                </p>
                <div className="mt-3 text-sm text-purple-600 font-medium">
                  Click to get personalized →
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
