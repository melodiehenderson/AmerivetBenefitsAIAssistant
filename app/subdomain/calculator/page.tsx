/**
 * Medical Plan Cost Comparison Tool page for subdomain users
 */

'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AMERIVET_KAISER_AVAILABLE_STATE_CODES,
  AMERIVET_MEDICAL_PLANS,
} from '@/lib/data/amerivet-benefits';
import {
  buildCalculatorPlanPricing,
  getCalculatorPlanMonthlyPremium,
  type CalculatorCoverageSelection,
} from '@/lib/utils/medical-cost-calculator';
import { ArrowLeft, Calculator, DollarSign, Activity, Pill, Hospital, HeartPulse, AlertCircle } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { AmeriVetLogo } from '@/components/amerivet-logo';

const catalogPlans = AMERIVET_MEDICAL_PLANS;

// US States for dropdown
const US_STATES = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' }, { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' }, { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' }, { code: 'DC', name: 'District of Columbia' },
  { code: 'FL', name: 'Florida' }, { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' }, { code: 'IL', name: 'Illinois' }, { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' }, { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' }, { code: 'ME', name: 'Maine' }, { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' }, { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' }, { code: 'MO', name: 'Missouri' }, { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' }, { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' }, { code: 'NM', name: 'New Mexico' }, { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' }, { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' }, { code: 'OR', name: 'Oregon' }, { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' }, { code: 'SC', name: 'South Carolina' }, { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' }, { code: 'TX', name: 'Texas' }, { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' }, { code: 'VA', name: 'Virginia' }, { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' }, { code: 'WI', name: 'Wisconsin' }, { code: 'WY', name: 'Wyoming' },
];

export default function CalculatorPage() {
  const router = useRouter();
  const [planType, setPlanType] = useState(catalogPlans[0]?.id ?? 'bcbstx-standard-hsa');
  const [coverage, setCoverage] = useState<CalculatorCoverageSelection>('employee-only');
  const [userState, setUserState] = useState('');
  const [salary, setSalary] = useState('60000');
  const [visits, setVisits] = useState([10]);
  const [hospitalDays, setHospitalDays] = useState([0]);
  const [rxPerMonth, setRxPerMonth] = useState([7]);
  const [surgeries, setSurgeries] = useState([0]);

  const isKaiserAvailable = Boolean(
    userState
    && AMERIVET_KAISER_AVAILABLE_STATE_CODES.includes(
      userState as (typeof AMERIVET_KAISER_AVAILABLE_STATE_CODES)[number],
    ),
  );

  useEffect(() => {
    // Check auth
    fetch('/api/subdomain/auth/session', { credentials: 'include' })
      .then(res => !res.ok && router.push('/subdomain/login'))
      .catch(() => router.push('/subdomain/login'));
  }, [router]);

  // Reset plan if Kaiser selected but not available in new state
  useEffect(() => {
    if (planType === 'kaiser-standard-hmo' && !isKaiserAvailable) {
      setPlanType(catalogPlans[0]?.id ?? 'bcbstx-standard-hsa');
    }
  }, [userState, isKaiserAvailable, planType]);

  // Build pricing from the canonical amerivet.ts catalog
  const pricing = Object.fromEntries(
    catalogPlans.map((p) => [
      p.id,
      buildCalculatorPlanPricing(p),
    ]),
  ) as Record<string, ReturnType<typeof buildCalculatorPlanPricing>>;

  const calc = useMemo(() => {
    const conf = pricing[planType] ?? pricing[catalogPlans[0]?.id ?? ''];
    const premiumMonthly = conf.monthlyByCoverage[coverage] ?? 0;
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
            <AmeriVetLogo
              alt="AmeriVet"
              width={40}
              height={40}
              className="mr-3"
            />
            <Button variant="outline" onClick={() => router.push('/subdomain/dashboard')} className="mr-4">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Dashboard
            </Button>
            <h1 className="text-2xl font-bold text-gray-900">Medical Plan Cost Comparison Tool</h1>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Calculator className="w-6 h-6 mr-2 text-green-600" />
              Interactive Benefits Medical Plan Cost Comparison Tool
            </CardTitle>
            <CardDescription>
              Select a plan, adjust expected usage, and see your costs update instantly
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* State selector */}
              <div className="space-y-2">
                <Label htmlFor="userState">Your State</Label>
                <Select value={userState} onValueChange={setUserState}>
                  <SelectTrigger id="userState">
                    <SelectValue placeholder="Select your state..." />
                  </SelectTrigger>
                  <SelectContent>
                    {US_STATES.map(s => (
                      <SelectItem key={s.code} value={s.code}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Plan Type selector */}
              <div className="space-y-2">
                <Label htmlFor="planType">Plan Type</Label>
                <Select value={planType} onValueChange={setPlanType}>
                  <SelectTrigger id="planType">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {catalogPlans
                      .filter((p) => {
                        if (p.provider.toLowerCase().includes('kaiser')) {
                          return isKaiserAvailable;
                        }
                        return true;
                      })
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name} - ${Math.round(getCalculatorPlanMonthlyPremium(p, coverage))}/month
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {userState && !isKaiserAvailable && (
                  <div className="flex items-center gap-1 text-xs text-amber-600">
                    <AlertCircle className="w-3 h-3" />
                    Kaiser HMO not available in {US_STATES.find(s => s.code === userState)?.name}
                  </div>
                )}
              </div>

              {/* Coverage Level selector - now with 4 tiers */}
              <div className="space-y-2">
                <Label htmlFor="coverage">Coverage Level</Label>
                <Select value={coverage} onValueChange={(value) => setCoverage(value as CalculatorCoverageSelection)}>
                  <SelectTrigger id="coverage">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employee-only">Employee Only</SelectItem>
                    <SelectItem value="employee-spouse">Employee + Spouse</SelectItem>
                    <SelectItem value="employee-children">Employee + Child(ren)</SelectItem>
                    <SelectItem value="employee-family">Employee + Family</SelectItem>
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
                <CardTitle className="text-lg">Cost Breakdown for {pricing[planType]?.label ?? planType}</CardTitle>
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
