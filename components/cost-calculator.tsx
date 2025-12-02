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
import { DollarSign } from 'lucide-react';

interface PlanCost {
  name: string;
  premium: number;
  deductible: number;
  outOfPocketMax: number;
  estimatedCost: number;
}

export function CostCalculator() {
  const [plan, setPlan] = useState('HSA High Deductible - $250/month');
  const [coverage, setCoverage] = useState<'Individual' | 'Family'>('Individual');
  const [doctorVisits, setDoctorVisits] = useState(0);
  const [prescriptions, setPrescriptions] = useState(0);
  const [hospitalDays, setHospitalDays] = useState(0);
  const [surgeries, setSurgeries] = useState(0);
  const [planCosts, setPlanCosts] = useState<PlanCost[]>([]);

  let monthlyPremium = 300;
  if (plan.includes('HSA')) {
    monthlyPremium = 250;
  } else if (plan.includes('PPO')) {
    monthlyPremium = 400;
  }
  const premiumAdj = coverage === 'Family' ? 2 : 1;

  const doctorCost = doctorVisits * 150;
  const rxCost = prescriptions * 50 * 12; // monthly prescriptions -> annual
  const hospitalCost = hospitalDays * 1000;
  const surgeryCost = surgeries * 2000;
  const estimatedMedicalCosts = doctorCost + rxCost + hospitalCost + surgeryCost;

  const plans = [
    { name: 'HSA High Deductible', premium: monthlyPremium * 12 * premiumAdj, deductible: 3500, outOfPocketMax: 7000 },
    { name: 'PPO Plan', premium: 4800 * premiumAdj, deductible: 1000, outOfPocketMax: 5000 },
    { name: 'Kaiser HMO', premium: 3600 * premiumAdj, deductible: 0, outOfPocketMax: 3500 },
  ];

  function selectedPlanName() {
    if (plan.includes('HSA')) return 'HSA High Deductible';
    if (plan.includes('PPO')) return 'PPO Plan';
    return 'Kaiser HMO';
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
    const list = planCosts.length ? planCosts : plans.map((p) => ({ ...p, estimatedCost: p.premium + Math.min(estimatedMedicalCosts, p.outOfPocketMax) } as PlanCost));
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Health Plan</Label>
              <select className="mt-1 w-full rounded border p-2" value={plan} onChange={(e) => setPlan(e.target.value)}>
                <option>HSA High Deductible - $250/month</option>
                <option>PPO - $400/month</option>
                <option>Kaiser HMO - $300/month</option>
              </select>
            </div>
            <div>
              <Label>Coverage Type</Label>
              <select className="mt-1 w-full rounded border p-2" value={coverage} onChange={(e) => setCoverage(e.target.value as any)}>
                <option>Individual</option>
                <option>Family</option>
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
                  const summary = `Please review these results and advise: Plan=${selected.name}, Monthly Premium=$${(selected.premium/12).toLocaleString()}, Estimated OOP=$${Math.min(selected.outOfPocketMax, Math.max(0, selected.estimatedCost - selected.premium)).toLocaleString()}, Total Annual Cost=$${selected.estimatedCost.toLocaleString()}. Profile: ${coverage} coverage; usage — ${doctorVisits} doctor visits, ${prescriptions} monthly prescriptions, ${hospitalDays} hospital days, ${surgeries} surgeries.`;
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
