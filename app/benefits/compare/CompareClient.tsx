'use client';

import nextDynamic from 'next/dynamic';

const Calculator = nextDynamic(() => import('../../../components/cost-calculator').then(m => m.CostCalculator), {
  ssr: false,
});

export default function CompareClient() {
  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-5xl mx-auto">
        <div className="mb-4">
          <h1 className="text-2xl font-semibold">Plan Comparison</h1>
          <p className="text-gray-600">Adjust inputs to see real-time costs. When ready, send a summary to chat for guidance.</p>
        </div>
        <Calculator />
      </div>
    </div>
  );
}

