'use client';

/**
 * User Satisfaction Survey Component
 * Collects CSAT (1-5 stars) and NPS (0-10) ratings after conversation
 */

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { QualityTracker } from '@/lib/analytics/quality-tracker';
import type { UserSatisfactionSurvey } from '@/types/rag';

interface SatisfactionSurveyProps {
  conversationId: string;
  userId: string;
  companyId: string;
  onSubmit?: (survey: UserSatisfactionSurvey) => void;
  onSkip?: () => void;
}

export function SatisfactionSurvey({
  conversationId,
  userId,
  companyId,
  onSubmit,
  onSkip,
}: SatisfactionSurveyProps) {
  const [csatRating, setCsatRating] = useState<number | null>(null);
  const [npsScore, setNpsScore] = useState<number | null>(null);
  const [feedback, setFeedback] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [hoveredStar, setHoveredStar] = useState<number | null>(null);
  const [hoveredNps, setHoveredNps] = useState<number | null>(null);

  const handleSubmit = async () => {
    if (csatRating === null || npsScore === null) {
      alert('Please provide both ratings');
      return;
    }

    const survey: UserSatisfactionSurvey = {
      surveyId: `survey-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      conversationId,
      userId,
      companyId,
      csatRating,
      npsScore,
      feedback: feedback.trim() || undefined,
      timestamp: Date.now(),
      tags: generateTags(csatRating, npsScore, feedback),
    };

    // Record in quality tracker
    QualityTracker.recordSurvey(survey);

    // Call parent callback
    onSubmit?.(survey);

    setSubmitted(true);
  };

  const handleSkip = () => {
    onSkip?.();
  };

  const generateTags = (csat: number, nps: number, text: string): string[] => {
    const tags: string[] = [];

    // CSAT-based tags
    if (csat >= 4) tags.push('satisfied');
    if (csat === 5) tags.push('very-satisfied');
    if (csat <= 2) tags.push('unsatisfied');

    // NPS-based tags
    if (nps >= 9) tags.push('promoter');
    if (nps >= 7 && nps < 9) tags.push('passive');
    if (nps < 7) tags.push('detractor');

    // Sentiment analysis (simple keyword matching)
    const lowerText = text.toLowerCase();
    if (lowerText.includes('helpful')) tags.push('helpful');
    if (lowerText.includes('fast') || lowerText.includes('quick')) tags.push('fast');
    if (lowerText.includes('accurate') || lowerText.includes('correct')) tags.push('accurate');
    if (lowerText.includes('confus') || lowerText.includes('unclear')) tags.push('confusing');
    if (lowerText.includes('slow')) tags.push('slow');
    if (lowerText.includes('wrong') || lowerText.includes('incorrect')) tags.push('inaccurate');

    return tags;
  };

  if (submitted) {
    return (
      <Card className="w-full max-w-2xl mx-auto">
        <CardContent className="pt-6">
          <div className="text-center space-y-4">
            <svg
              className="mx-auto h-12 w-12 text-green-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <h3 className="text-lg font-semibold">Thank you for your feedback!</h3>
            <p className="text-sm text-muted-foreground">
              Your response helps us improve our service.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>How was your experience?</CardTitle>
        <CardDescription>
          Help us improve by sharing your feedback (takes 30 seconds)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* CSAT Rating (1-5 stars) */}
        <div className="space-y-3">
          <label className="text-sm font-medium">
            How satisfied are you with the answer you received?
          </label>
          <div className="flex items-center gap-2">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onClick={() => setCsatRating(star)}
                onMouseEnter={() => setHoveredStar(star)}
                onMouseLeave={() => setHoveredStar(null)}
                className="transition-transform hover:scale-110 focus:outline-none"
              >
                <svg
                  className={`w-10 h-10 ${
                    star <= (hoveredStar ?? csatRating ?? 0)
                      ? 'text-yellow-400 fill-current'
                      : 'text-gray-300'
                  }`}
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                >
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              </button>
            ))}
            <span className="ml-2 text-sm text-muted-foreground">
              {csatRating
                ? ['Very Unsatisfied', 'Unsatisfied', 'Neutral', 'Satisfied', 'Very Satisfied'][
                    csatRating - 1
                  ]
                : ''}
            </span>
          </div>
        </div>

        {/* NPS Score (0-10) */}
        <div className="space-y-3">
          <label className="text-sm font-medium">
            How likely are you to recommend this service to a colleague?
          </label>
          <div className="space-y-2">
            <div className="flex gap-1">
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((score) => (
                <button
                  key={score}
                  type="button"
                  onClick={() => setNpsScore(score)}
                  onMouseEnter={() => setHoveredNps(score)}
                  onMouseLeave={() => setHoveredNps(null)}
                  className={`flex-1 py-2 text-sm font-medium rounded border transition-colors ${
                    score === npsScore
                      ? 'bg-primary text-primary-foreground border-primary'
                      : score === hoveredNps
                      ? 'bg-secondary border-primary'
                      : 'bg-background border-border hover:bg-secondary'
                  }`}
                >
                  {score}
                </button>
              ))}
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Not at all likely</span>
              <span>Extremely likely</span>
            </div>
            {npsScore !== null && (
              <p className="text-sm text-center text-muted-foreground">
                {npsScore >= 9
                  ? '🎉 Promoter - Thank you!'
                  : npsScore >= 7
                  ? '👍 Passive'
                  : '😔 Detractor - We appreciate your honesty'}
              </p>
            )}
          </div>
        </div>

        {/* Optional Feedback */}
        <div className="space-y-3">
          <label className="text-sm font-medium">
            Any additional comments? <span className="text-muted-foreground">(Optional)</span>
          </label>
          <Textarea
            placeholder="Tell us more about your experience..."
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={4}
            className="resize-none"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <Button onClick={handleSubmit} className="flex-1" disabled={csatRating === null || npsScore === null}>
            Submit Feedback
          </Button>
          <Button onClick={handleSkip} variant="outline">
            Skip
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Inline Survey Component (Compact version for chat interface)
 */
export function InlineSatisfactionSurvey({
  conversationId,
  userId,
  companyId,
  onSubmit,
  onSkip,
}: SatisfactionSurveyProps) {
  const [csatRating, setCsatRating] = useState<number | null>(null);

  const handleQuickRating = async (rating: number) => {
    setCsatRating(rating);

    // Auto-submit with neutral NPS score
    const survey: UserSatisfactionSurvey = {
      surveyId: `survey-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      conversationId,
      userId,
      companyId,
      csatRating: rating,
      npsScore: 7, // Default neutral NPS
      timestamp: Date.now(),
      tags: rating >= 4 ? ['satisfied', 'quick-rating'] : ['unsatisfied', 'quick-rating'],
    };

    QualityTracker.recordSurvey(survey);
    onSubmit?.(survey);
  };

  return (
    <div className="flex items-center gap-3 p-4 bg-secondary/50 rounded-lg">
      <span className="text-sm font-medium">Was this helpful?</span>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onClick={() => handleQuickRating(star)}
            className="transition-transform hover:scale-110 focus:outline-none"
          >
            <svg
              className={`w-6 h-6 ${
                star <= (csatRating ?? 0) ? 'text-yellow-400 fill-current' : 'text-gray-300'
              }`}
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
            >
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </button>
        ))}
      </div>
      <button
        onClick={onSkip}
        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        Dismiss
      </button>
    </div>
  );
}
