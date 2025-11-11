/**
 * Cost Calculator page for subdomain users
 */

'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Calculator, DollarSign, Activity, Pill, Hospital, HeartPulse } from 'lucide-react';
import { Slider } from '@/components/ui/slider';

export default function CalculatorPage() {
  const router = useRouter();
  const [planType, setPlanType] = useState('hsa-high');
  const [coverage, setCoverage] = useState('individual');
  const [salary, setSalary] = useState('60000');
  const [visits, setVisits] = useState([10]);
  const [hospitalDays, setHospitalDays] = useState([0]);
  const [rxPerMonth, setRxPerMonth] = useState([7]);
  const [surgeries, setSurgeries] = useState([0]);

  useEffect(() => {
    // Check auth
    fetch('/api/subdomain/auth/session', { credentials: 'include' })
      .then(res => !res.ok && router.push('/subdomain/login'))
      .catch(() => router.push('/subdomain/login'));
  }, [router]);

  const pricing = {
    'hsa-high': { label: 'HSA High Deductible', monthly: 250, copayVisit: 20, hospDay: 200, rx: 10, surgery: 500 },
    'ppo-standard': { label: 'PPO Standard', monthly: 380, copayVisit: 25, hospDay: 150, rx: 12, surgery: 400 },
    'ppo-premium': { label: 'PPO Premium', monthly: 520, copayVisit: 15, hospDay: 120, rx: 8, surgery: 300 },
  } as const;

  const calc = useMemo(() => {
    const conf = pricing[planType as keyof typeof pricing];
    const premiumMonthly = conf.monthly * (coverage === 'family' ? 2.5 : 1);
    const premiumAnnual = premiumMonthly * 12;
    const usage = {
      visits: visits[0] * conf.copayVisit,
      hospital: hospitalDays[0] * conf.hospDay,
      rx: rxPerMonth[0] * 12 * conf.rx,
      surgeries: surgeries[0] * conf.surgery,
    };
    const outOfPocket = usage.visits + usage.hospital + usage.rx + usage.surgeries;
    const total = premiumAnnual + outOfPocket;
    return { conf, premiumMonthly, premiumAnnual, usage, outOfPocket, total };
  }, [planType, coverage, visits, hospitalDays, rxPerMonth, surgeries]);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center">
            <Button variant="outline" onClick={() => router.push('/subdomain/dashboard')} className="mr-4">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Dashboard
            </Button>
            <h1 className="text-2xl font-bold text-gray-900">Cost Calculator</h1>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Calculator className="w-6 h-6 mr-2 text-green-600" />
              Interactive Benefits Cost Calculator
            </CardTitle>
            <CardDescription>
              Select a plan, adjust expected usage, and see your costs update instantly
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="planType">Plan Type</Label>
                <Select value={planType} onValueChange={setPlanType}>
                  <SelectTrigger id="planType">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hsa-high">HSA High Deductible - ${pricing['hsa-high'].monthly}/month</SelectItem>
                    <SelectItem value="ppo-standard">PPO Standard - ${pricing['ppo-standard'].monthly}/month</SelectItem>
                    <SelectItem value="ppo-premium">PPO Premium - ${pricing['ppo-premium'].monthly}/month</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="coverage">Coverage Level</Label>
                <Select value={coverage} onValueChange={setCoverage}>
                  <SelectTrigger id="coverage">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="individual">Individual</SelectItem>
                    <SelectItem value="family">Family</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="salary">Annual Salary</Label>
                <Input
                  id="salary"
                  type="number"
                  value={salary}
                  onChange={(e) => setSalary(e.target.value)}
                  placeholder="50000"
                />
              </div>
            </div>

            {/* Usage sliders */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <div className="flex items-center justify-between mb-1 text-sm text-gray-700"><span className="flex items-center gap-2"><Activity className="w-4 h-4 text-blue-600"/>Doctor Visits</span><span>{visits[0]} visits</span></div>
                <Slider min={0} max={20} step={1} value={visits} onValueChange={setVisits} />
                <div className="flex justify-between text-xs text-gray-500 mt-1"><span>0</span><span>20+</span></div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1 text-sm text-gray-700"><span className="flex items-center gap-2"><Hospital className="w-4 h-4 text-red-600"/>Hospital Days</span><span>{hospitalDays[0]} days</span></div>
                <Slider min={0} max={10} step={1} value={hospitalDays} onValueChange={setHospitalDays} />
                <div className="flex justify-between text-xs text-gray-500 mt-1"><span>0</span><span>10+</span></div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1 text-sm text-gray-700"><span className="flex items-center gap-2"><Pill className="w-4 h-4 text-green-600"/>Monthly Prescriptions</span><span>{rxPerMonth[0]} per month</span></div>
                <Slider min={0} max={10} step={1} value={rxPerMonth} onValueChange={setRxPerMonth} />
                <div className="flex justify-between text-xs text-gray-500 mt-1"><span>0</span><span>10+</span></div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1 text-sm text-gray-700"><span className="flex items-center gap-2"><HeartPulse className="w-4 h-4 text-purple-600"/>Expected Surgeries</span><span>{surgeries[0]} procedures</span></div>
                <Slider min={0} max={3} step={1} value={surgeries} onValueChange={setSurgeries} />
                <div className="flex justify-between text-xs text-gray-500 mt-1"><span>0</span><span>3+</span></div>
              </div>
            </div>

            {/* Cost breakdown */}
            <Card className="border">
              <CardHeader>
                <CardTitle className="text-lg">Cost Breakdown for {pricing[planType as keyof typeof pricing].label}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card className="bg-blue-50 border-blue-200"><CardContent className="p-4 text-center"><div className="text-xs text-blue-700">Monthly Premium</div><div className="text-3xl font-bold text-blue-700">${calc.premiumMonthly.toFixed(0)}</div></CardContent></Card>
                  <Card className="bg-amber-50 border-amber-200"><CardContent className="p-4 text-center"><div className="text-xs text-amber-800">Est. Out-of-Pocket</div><div className="text-3xl font-bold text-amber-800">${calc.outOfPocket.toFixed(0)}</div></CardContent></Card>
                  <Card className="bg-green-50 border-green-200"><CardContent className="p-4 text-center"><div className="text-xs text-green-800">Total Annual Cost</div><div className="text-3xl font-bold text-green-800">${calc.total.toFixed(0)}</div></CardContent></Card>
                </div>
                <div>
                  <div className="text-sm font-semibold mb-2">Cost Breakdown by Service</div>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
                    <Card><CardContent className="p-3"><div className="text-gray-500">Doctor Visits</div><div className="font-semibold">${calc.usage.visits.toFixed(0)}</div></CardContent></Card>
                    <Card><CardContent className="p-3"><div className="text-gray-500">Hospital</div><div className="font-semibold">${calc.usage.hospital.toFixed(0)}</div></CardContent></Card>
                    <Card><CardContent className="p-3"><div className="text-gray-500">Prescriptions</div><div className="font-semibold">${calc.usage.rx.toFixed(0)}</div></CardContent></Card>
                    <Card><CardContent className="p-3"><div className="text-gray-500">Surgeries</div><div className="font-semibold">${calc.usage.surgeries.toFixed(0)}</div></CardContent></Card>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="font-semibold text-blue-900 mb-2">How this is calculated:</h3>
              <ul className="text-sm text-blue-800 space-y-1">
                <li>• Illustrative pricing only; replace with plan-specific rates when available</li>
                <li>• Monthly premium is multiplied by 12 for annual premium</li>
                <li>• Usage costs use simple per-event estimates (copays/coinsurance)</li>
                <li>• Actual costs vary by plan design and network usage</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
