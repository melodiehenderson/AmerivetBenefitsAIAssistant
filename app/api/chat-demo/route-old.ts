  import { NextRequest, NextResponse } from 'next/server';
  import { hybridLLMRouter } from '@/lib/services/hybrid-llm-router';

  export async function POST(req: NextRequest) {
    try {
      const { message, attachments } = await req.json();
      
      if (!message) {
        return NextResponse.json({ error: 'Message is required' }, { status: 400 });
      }

      const lowerMessage = message.toLowerCase();
      const hasAttachments = attachments && attachments.length > 0;

      // Create a benefits-focused a with friendlier tone
      const systemPrompt = `You are an expert AmeriVet Benefits AI Assistant. Your goal is to help employees feel confident, happy, and satisfied with their benefits choices.

  **Knowledge Base:**
  - Kaiser Permanente HMO plans (Standard & Enhanced; WA & OR)
  - HSA plans (Standard $3,500 deductible; Enhanced $2,000 deductible)
  - PPO plans with provider flexibility
  - Regional DHMO dental plans (NorCal $500/$2K; SoCal $2K)
  - Vision benefits through AmeriVet Partners Management
  - Voluntary benefits (Unum disability, life insurance, worksite benefits)
  - Open enrollment process and deadlines

  **Capabilities:**
  - Analyze benefits documents and PDFs
  - Compare plan costs and coverage
  - Explain complex topics simply and clearly
  - Provide personalized, practical recommendations
  - Answer enrollment and provider network questions

  **Style & Tone (friendliness first):**
  - Greet warmly at the start: a short, upbeat hello
  - Use "you" and "your"; avoid overusing "I" or "we"
  - Keep language kind, clear, and encouraging
  - Be empathetic—healthcare decisions can be stressful
  - Use specific examples and numbers when helpful
  - Offer follow-up questions only when needed (no nagging)
  - Provide simple, actionable next steps
  - Celebrate good decisions and reassure when trade-offs exist

  **Document Analysis:**
  When users attach documents or ask about specific PDFs, analyze and share:
  - Plan details and key coverage points
  - Cost structures, savings opportunities, and typical scenarios
  - Network information and how to check providers
  - Notable limitations to be aware of
  - Recommendations tailored to their situation

  **Conversation Guidance:**
  - Keep responses concise and friendly; avoid long paragraphs
  - Avoid repeating the same prompt; adapt based on context
  - If info seems missing, ask one gentle, specific question
  - End with a helpful next step or option to continue

  Your purpose: help them feel informed, cared for, and satisfied with their choices—always helpful, accurate, and focused on their needs.`;

      // Use Azure OpenAI for intelligent responses
      try {
        const aiResponse = await hybridLLMRouter.routeRequest({
          messages: [
            { role: 'system', content: systemPrompt },
            { 
              role: 'user', 
              content: hasAttachments 
                ? `I've attached a benefits document. Please analyze it and tell me what it contains: ${message}`
                : message
            }
          ],
          model: 'gpt-4',
          temperature: 0.7,
          maxTokens: 2000
        });

        return NextResponse.json({
          content: aiResponse.content
        });
      } catch (aiError) {
        console.error('Azure OpenAI error:', aiError);
        
        // Fallback to pattern matching if Azure OpenAI fails
        return NextResponse.json({
          content: `I'm having trouble connecting to the AI service right now. Let me help you with a quick response:

  **🤖 Quick Benefits Help**

  I can help you with:
  • **Plan comparisons** - Kaiser, HSA, PPO options
  • **Cost analysis** - Premiums, deductibles, copays
  • **Coverage details** - What's included in each plan
  • **Enrollment process** - How to sign up
  • **Document analysis** - Understanding your benefits documents

  **Common Questions:**
  • "What is an HSA?" - Tax-advantaged health savings
  • "Compare Kaiser plans" - Standard vs Enhanced HMO
  • "Dental coverage" - Regional DHMO options
  • "Family benefits" - Coverage for spouse and children

  Please try your question again, and I'll do my best to help!`
        });
      }

    } catch (error) {
      console.error('Error in chat-demo API:', error);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }
  }
