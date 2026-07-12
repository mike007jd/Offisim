import { useUiState } from '@/app/ui-state.js';
import {
  type TokenBudgetSettings,
  loadTokenBudgets,
  saveTokenBudgets,
} from '@/data/token-budgets.js';
import { CardBlock } from '@/design-system/grammar/index.js';
import { Button } from '@/design-system/primitives/button.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

function parseBudget(value: string, label: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive whole number.`);
  }
  return parsed;
}

export function TokenBudgetSettingsCard() {
  const companyId = useUiState((state) => state.companyId) || null;
  const queryClient = useQueryClient();
  const budgets = useQuery({
    queryKey: ['token-budgets', companyId],
    queryFn: () => loadTokenBudgets(companyId),
    enabled: companyId !== null,
  });
  const [monthly, setMonthly] = useState('');
  const [session, setSession] = useState('');
  useEffect(() => {
    setMonthly(budgets.data?.monthlyTokenBudget?.toString() ?? '');
    setSession(budgets.data?.sessionTokenBudget?.toString() ?? '');
  }, [budgets.data]);
  const save = useMutation({
    mutationFn: async (value: TokenBudgetSettings) => {
      if (!companyId) throw new Error('Select a company first.');
      return saveTokenBudgets(companyId, value);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['token-budgets', companyId] }),
        queryClient.invalidateQueries({ queryKey: ['run-cost'] }),
      ]);
      toast.success('Token budget alerts updated');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Could not save token budgets.'),
  });

  function handleSave() {
    try {
      save.mutate({
        monthlyTokenBudget: parseBudget(monthly, 'Monthly budget'),
        sessionTokenBudget: parseBudget(session, 'Session budget'),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Invalid token budget.');
    }
  }

  return (
    <CardBlock>
      <div className="off-field">
        <span className="off-field-label">Token budget alerts</span>
        <span className="off-field-hint">
          Warn at 80% and 100%. Alerts are informational and never stop a run. Leave a field blank
          for no alert.
        </span>
      </div>
      <div className="off-set-budget-grid">
        <label className="off-field">
          <span className="off-field-label">Company monthly tokens</span>
          <input
            className="off-input"
            inputMode="numeric"
            placeholder="No alert"
            value={monthly}
            onChange={(event) => setMonthly(event.target.value)}
          />
        </label>
        <label className="off-field">
          <span className="off-field-label">Per-session tokens</span>
          <input
            className="off-input"
            inputMode="numeric"
            placeholder="No alert"
            value={session}
            onChange={(event) => setSession(event.target.value)}
          />
        </label>
      </div>
      <Button size="sm" onClick={handleSave} disabled={!companyId || save.isPending}>
        {save.isPending ? 'Saving…' : 'Save alert budgets'}
      </Button>
    </CardBlock>
  );
}
