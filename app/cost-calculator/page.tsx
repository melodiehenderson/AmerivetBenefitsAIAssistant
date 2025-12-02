'use client';

import dynamic from 'next/dynamic';

const Calculator = dynamic(() => import('../../components/cost-calculator').then(m => m.CostCalculator), {
  ssr: false,
});

export default function CostCalculatorAliasPage() {
  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-5xl mx-auto">
        <div className="mb-4">
          <h1 className="text-2xl font-semibold">Medical Plan Cost Comparison Tool</h1>
          <p className="text-gray-600">A friendly alias for Plan Comparison.</p>
        </div>
        <Calculator />
      </div>
    </div>
  );
}




