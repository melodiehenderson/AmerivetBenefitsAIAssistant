import { useState } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DollarSign, AlertCircle } from 'lucide-react';
import { amerivetBenefits2024_2025, KAISER_AVAILABLE_STATE_CODES, type BenefitTier } from '@/lib/data/amerivet';

// All US states for dropdown
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

const coverageTierToBenefitTier: Record<CoverageTier, BenefitTier> = {
  'Employee Only': 'employeeOnly',
  'Employee + Spouse': 'employeeSpouse',
  'Employee + Child(ren)': 'employeeChildren',
  'Employee + Family': 'employeeFamily',
};

type CoverageTier = 'Employee Only' | 'Employee + Spouse' | 'Employee + Child(ren)' | 'Employee + Family';

interface PlanCost {
  name: string;
  premium: number;
  deductible: number;
  outOfPocketMax: number;
  estimatedCost: number;
  available: boolean;
}

export function CostCalculator() {
  const medicalPlans = amerivetBenefits2024_2025.medicalPlans;
  const [plan, setPlan] = useState(medicalPlans[0]?.name || 'Standard HSA');
  const [coverage, setCoverage] = useState<CoverageTier>('Employee Only');
  const [userState, setUserState] = useState('');
  const [doctorVisits, setDoctorVisits] = useState(0);
  const [prescriptions, setPrescriptions] = useState(0);
  const [hospitalDays, setHospitalDays] = useState(0);
  const [surgeries, setSurgeries] = useState(0);
  const [planCosts, setPlanCosts] = useState<PlanCost[]>([]);

  const STATE_TO_REGION: Record<string, string> = { CA: 'California', WA: 'Washington', OR: 'Oregon' };
  const region = STATE_TO_REGION[userState] ?? 'nationwide';
  const availablePlans = medicalPlans.filter((p) =>
    p.regionalAvailability.includes('nationwide') ||
    p.regionalAvailability.includes(region)
  );

  const isKaiserAvailable = !!availablePlans.find((p) => p.provider.toLowerCase().includes('kaiser'));

  const benefitTier = coverageTierToBenefitTier[coverage];

  const doctorCost = doctorVisits * 150;
  const rxCost = prescriptions * 50 * 12; // monthly prescriptions -> annual
  const hospitalCost = hospitalDays * 1000;
  const surgeryCost = surgeries * 2000;
  const estimatedMedicalCosts = doctorCost + rxCost + hospitalCost + surgeryCost;

  const plans = availablePlans.map((p) => {
    const monthly = p.tiers?.[benefitTier] ?? 0;
    return {
      name: p.name,
      premium: monthly * 12, // annual premium
      deductible: p.benefits?.deductible ?? 0,
      outOfPocketMax: p.benefits?.outOfPocketMax ?? 0,
      available: true,
    };
  });

  function selectedPlanName() {
    return plan;
  }

  const calculateCosts = () => {
    const calculatedCosts = plans.map((p) => {
      const costsAfterPremium = Math.min(estimatedMedicalCosts, p.outOfPocketMax);
      const totalCost = p.premium + costsAfterPremium;
      return { ...p, estimatedCost: totalCost } as PlanCost;
    });

    setPlanCosts(calculatedCosts);
  };

  const selected = (() => {
    const list = planCosts.length
      ? planCosts
      : plans.map((p) => ({ ...p, estimatedCost: p.premium + Math.min(estimatedMedicalCosts, p.outOfPocketMax) } as PlanCost));
    return list.find((p) => p.name === selectedPlanName()) || list[0];
  })();

  const monthlyPremiumDisplay = (selected.premium / 12).toLocaleString();
  const estOOPDisplay = Math.min(selected.outOfPocketMax, Math.max(0, selected.estimatedCost - selected.premium)).toLocaleString();
  const totalAnnualDisplay = selected.estimatedCost.toLocaleString();

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="size-5" />
            Medical Plan Cost Comparison Tool
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Selectors */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label>Your State</Label>
              <select className="mt-1 w-full rounded border p-2" value={userState} onChange={(e) => {
                setUserState(e.target.value);
                // Reset plan if Kaiser selected but not available in new state
                if (/kaiser/i.test(plan) && !KAISER_AVAILABLE_STATE_CODES.includes(e.target.value as typeof KAISER_AVAILABLE_STATE_CODES[number])) {
                  setPlan(medicalPlans[0]?.name || 'Standard HSA');
                }
              }}>
                <option value="">Select your state...</option>
                {US_STATES.map(s => (
                  <option key={s.code} value={s.code}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Health Plan</Label>
              <select className="mt-1 w-full rounded border p-2" value={plan} onChange={(e) => setPlan(e.target.value)}>
                {availablePlans.map((p) => {
                  const monthly = (p.tiers?.[benefitTier] ?? 0).toFixed(2);
                  return (
                    <option key={p.id} value={p.name}>
                      {p.name} - ${monthly}/month
                    </option>
                  );
                })}
              </select>
              {userState && !isKaiserAvailable && (
                <div className="flex items-center gap-1 mt-1 text-xs text-amber-600">
                  <AlertCircle className="size-3" />
                  Kaiser HMO is not available in {US_STATES.find(s => s.code === userState)?.name || userState}
                </div>
              )}
            </div>
            <div>
              <Label>Coverage Tier</Label>
              <select className="mt-1 w-full rounded border p-2" value={coverage} onChange={(e) => setCoverage(e.target.value as CoverageTier)}>
                <option value="Employee Only">Employee Only</option>
                <option value="Employee + Spouse">Employee + Spouse</option>
                <option value="Employee + Child(ren)">Employee + Child(ren)</option>
                <option value="Employee + Family">Employee + Family</option>
              </select>
            </div>
          </div>

          {/* Usage sliders */}
          <div>
            <h4 className="font-semibold mb-2">Expected Annual Usage</h4>
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <Label>Doctor Visits</Label>
                <input type="range" min={0} max={20} value={doctorVisits} onChange={(e) => setDoctorVisits(Number(e.target.value))} className="w-full"/>
                <div className="text-sm text-muted-foreground">{doctorVisits} visits</div>
              </div>
              <div>
                <Label>Hospital Days</Label>
                <input type="range" min={0} max={10} value={hospitalDays} onChange={(e) => setHospitalDays(Number(e.target.value))} className="w-full"/>
                <div className="text-sm text-muted-foreground">{hospitalDays} days</div>
              </div>
              <div>
                <Label>Monthly Prescriptions</Label>
                <input type="range" min={0} max={10} value={prescriptions} onChange={(e) => setPrescriptions(Number(e.target.value))} className="w-full"/>
                <div className="text-sm text-muted-foreground">{prescriptions} per month</div>
              </div>
              <div>
                <Label>Expected Surgeries</Label>
                <input type="range" min={0} max={3} value={surgeries} onChange={(e) => setSurgeries(Number(e.target.value))} className="w-full"/>
                <div className="text-sm text-muted-foreground">{surgeries} procedures</div>
              </div>
            </div>
          </div>

          <Button onClick={calculateCosts}>Calculate Costs</Button>
        </CardContent>
      </Card>

      {/* Metric pills */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-lg border p-4 bg-white">
          <div className="text-xs uppercase text-muted-foreground mb-1">Monthly Premium</div>
          <div className="text-2xl font-semibold text-blue-600">${monthlyPremiumDisplay}</div>
        </div>
        <div className="rounded-lg border p-4 bg-white">
          <div className="text-xs uppercase text-muted-foreground mb-1">Est. Out-of-Pocket</div>
          <div className="text-2xl font-semibold text-orange-600">${estOOPDisplay}</div>
        </div>
        <div className="rounded-lg border p-4 bg-white">
          <div className="text-xs uppercase text-muted-foreground mb-1">Total Annual Cost</div>
          <div className="text-2xl font-semibold text-emerald-600">${totalAnnualDisplay}</div>
        </div>
      </div>

      {/* Per-service breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Cost Breakdown by Service</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="rounded-lg border p-4 bg-white">
              <div className="text-sm font-medium">Doctor Visits</div>
              <div className="text-lg font-semibold">${doctorCost.toLocaleString()}</div>
            </div>
            <div className="rounded-lg border p-4 bg-white">
              <div className="text-sm font-medium">Prescriptions (annual)</div>
              <div className="text-lg font-semibold">${rxCost.toLocaleString()}</div>
            </div>
            <div className="rounded-lg border p-4 bg-white">
              <div className="text-sm font-medium">Hospital Days</div>
              <div className="text-lg font-semibold">${hospitalCost.toLocaleString()}</div>
            </div>
            <div className="rounded-lg border p-4 bg-white">
              <div className="text-sm font-medium">Surgeries</div>
              <div className="text-lg font-semibold">${surgeryCost.toLocaleString()}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {planCosts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Cost Breakdown for {selected.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plan</TableHead>
                  <TableHead className="text-right">Monthly Premium</TableHead>
                  <TableHead className="text-right">Est. Out-of-Pocket</TableHead>
                  <TableHead className="text-right">Total Annual Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {planCosts.map((p) => (
                  <TableRow key={p.name}>
                    <TableCell>{p.name}</TableCell>
                    <TableCell className="text-right">${(p.premium/12).toLocaleString()}</TableCell>
                    <TableCell className="text-right">${Math.min(p.outOfPocketMax, Math.max(0, p.estimatedCost - p.premium)).toLocaleString()}</TableCell>
                    <TableCell className="text-right">${p.estimatedCost.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-4 flex justify-end">
              <Button
                onClick={() => {
                  const stateName = US_STATES.find(s => s.code === userState)?.name || userState;
                  const summary = `Please review these results and advise: Plan=${selected.name}, Monthly Premium=$${(selected.premium/12).toLocaleString()}, Estimated OOP=$${Math.min(selected.outOfPocketMax, Math.max(0, selected.estimatedCost - selected.premium)).toLocaleString()}, Total Annual Cost=$${selected.estimatedCost.toLocaleString()}. Profile: ${coverage} coverage in ${stateName || 'unknown state'}; usage — ${doctorVisits} doctor visits, ${prescriptions} monthly prescriptions, ${hospitalDays} hospital days, ${surgeries} surgeries.`;
                  const url = `/chat?seed=${encodeURIComponent(summary)}`;
                  if (typeof window !== 'undefined') window.location.assign(url);
                }}
              >
                Chat about these results
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </motion.div>
  );
}
