import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from './ui/button';
import type { BenefitPlan } from '@/lib/data/amerivet';
import { getAmerivetBenefitsPackage } from '@/lib/data/amerivet-package';

interface Plan {
  id: string;
  name: string;
  premium: number;
  deductible: number;
  outOfPocketMax: number;
  type: string;
  category: string;
  provider: string;
}

function catalogPlanToComparisonPlan(p: BenefitPlan): Plan {
  return {
    id: p.id,
    name: p.name,
    premium: p.tiers.employeeOnly,
    deductible: p.benefits.deductible,
    outOfPocketMax: p.benefits.outOfPocketMax,
    type: p.type,
    category: p.type === 'medical'
      ? (p.provider.toLowerCase().includes('kaiser') ? 'HMO' : 'HSA')
      : p.type.toUpperCase(),
    provider: p.provider,
  };
}

export function PlanComparison() {
  const [allPlans, setAllPlans] = useState<Plan[]>([]);
  const [selectedPlanIds, setSelectedPlanIds] = useState<string[]>([]);
  const [comparison, setComparison] = useState<Plan[]>([]);

  useEffect(() => {
    const catalog = getAmerivetBenefitsPackage().catalog;
    const plans: Plan[] = [
      ...catalog.medicalPlans.map(catalogPlanToComparisonPlan),
      catalogPlanToComparisonPlan(catalog.dentalPlan),
      catalogPlanToComparisonPlan(catalog.visionPlan),
    ];
    setAllPlans(plans);
  }, []);

  const handleSelectPlan = (planId: string) => {
    setSelectedPlanIds((prev) =>
      prev.includes(planId)
        ? prev.filter((id) => id !== planId)
        : [...prev, planId],
    );
  };

  const comparePlans = () => {
    setComparison(allPlans.filter((plan) => selectedPlanIds.includes(plan.id)));
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full space-y-4"
    >
      <Card>
        <CardHeader>
          <CardTitle>Select Plans to Compare</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {allPlans.map((plan) => (
              <div key={plan.id} className="flex items-center space-x-2">
                <Checkbox
                  id={plan.id}
                  checked={selectedPlanIds.includes(plan.id)}
                  onCheckedChange={() => handleSelectPlan(plan.id)}
                />
                <label htmlFor={plan.id}>{plan.name}</label>
              </div>
            ))}
          </div>
          <Button onClick={comparePlans} disabled={selectedPlanIds.length < 2}>
            Compare Selected
          </Button>
        </CardContent>
      </Card>
      {comparison.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Plan Comparison</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Feature</TableHead>
                  {comparison.map((plan) => (
                    <TableHead key={plan.id}>{plan.name}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>Premium</TableCell>
                  {comparison.map((plan) => (
                    <TableCell key={plan.id}>${plan.premium}/mo</TableCell>
                  ))}
                </TableRow>
                <TableRow>
                  <TableCell>Deductible</TableCell>
                  {comparison.map((plan) => (
                    <TableCell key={plan.id}>${plan.deductible}</TableCell>
                  ))}
                </TableRow>
                <TableRow>
                  <TableCell>Out-of-Pocket Max</TableCell>
                  {comparison.map((plan) => (
                    <TableCell key={plan.id}>${plan.outOfPocketMax}</TableCell>
                  ))}
                </TableRow>
                <TableRow>
                  <TableCell>Type</TableCell>
                  {comparison.map((plan) => (
                    <TableCell key={plan.id}>
                      <Badge>{plan.type}</Badge>
                    </TableCell>
                  ))}
                </TableRow>
                <TableRow>
                  <TableCell>Category</TableCell>
                  {comparison.map((plan) => (
                    <TableCell key={plan.id}>
                      <Badge variant="secondary">{plan.category}</Badge>
                    </TableCell>
                  ))}
                </TableRow>
                <TableRow>
                  <TableCell>Provider</TableCell>
                  {comparison.map((plan) => (
                    <TableCell key={plan.id}>{plan.provider}</TableCell>
                  ))}
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </motion.div>
  );
}
