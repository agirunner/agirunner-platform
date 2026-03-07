import { useQuery } from '@tanstack/react-query';
import { Loader2, AlertTriangle, DollarSign, TrendingUp, PieChart } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  Cell,
  Pie,
  PieChart as RechartsPieChart,
  Legend,
} from 'recharts';
import { readSession } from '../../lib/session.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Badge } from '../../components/ui/badge.js';

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

interface CostSummary {
  today: number;
  this_week: number;
  this_month: number;
  budget_total: number;
  budget_remaining: number;
  by_workflow: Array<{ name: string; cost: number }>;
  by_model: Array<{ model: string; cost: number }>;
  daily_trend: Array<{ date: string; cost: number }>;
}

const CHART_COLORS = [
  '#6366f1', '#22c55e', '#eab308', '#ef4444', '#06b6d4',
  '#f97316', '#8b5cf6', '#ec4899', '#14b8a6', '#f59e0b',
];

function authHeaders(): Record<string, string> {
  const session = readSession();
  const headers: Record<string, string> = {};
  if (session?.accessToken) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }
  return headers;
}

async function fetchCostSummary(): Promise<CostSummary> {
  const response = await fetch(`${API_BASE_URL}/api/v1/metering/summary`, {
    headers: authHeaders(),
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const body = await response.json();
  return (body.data ?? body) as CostSummary;
}

function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function budgetPercentUsed(total: number, remaining: number): number {
  if (total <= 0) return 0;
  return Math.round(((total - remaining) / total) * 100);
}

function KpiCard({
  label,
  value,
  icon: Icon,
  warning,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  warning?: boolean;
}): JSX.Element {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-sm text-muted">
          <Icon className="h-4 w-4" />
          {label}
        </div>
        <p className={`mt-1 text-lg font-semibold ${warning ? 'text-red-600' : ''}`}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function CostByWorkflowChart({ data }: { data: Array<{ name: string; cost: number }> }): JSX.Element {
  if (data.length === 0) {
    return <p className="py-4 text-center text-sm text-muted-foreground">No workflow cost data.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 10, right: 20, bottom: 40, left: 20 }}>
        <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${v}`} />
        <Tooltip formatter={(v) => [`$${Number(v).toFixed(2)}`, 'Cost']} />
        <Bar dataKey="cost" fill="#6366f1" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function CostByModelChart({ data }: { data: Array<{ model: string; cost: number }> }): JSX.Element {
  if (data.length === 0) {
    return <p className="py-4 text-center text-sm text-muted-foreground">No model cost data.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <RechartsPieChart>
        <Pie
          data={data}
          dataKey="cost"
          nameKey="model"
          cx="50%"
          cy="50%"
          outerRadius={100}
          innerRadius={50}
          label={(props) => `${(props as { model?: string }).model ?? ''}: $${Number((props as { cost?: number }).cost ?? 0).toFixed(2)}`}
          labelLine={false}
        >
          {data.map((_, idx) => (
            <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(v) => [`$${Number(v).toFixed(2)}`, 'Cost']} />
        <Legend />
      </RechartsPieChart>
    </ResponsiveContainer>
  );
}

function DailyTrendChart({ data }: { data: Array<{ date: string; cost: number }> }): JSX.Element {
  if (data.length === 0) {
    return <p className="py-4 text-center text-sm text-muted-foreground">No daily trend data.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data} margin={{ top: 10, right: 20, bottom: 10, left: 20 }}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${v}`} />
        <Tooltip formatter={(v) => [`$${Number(v).toFixed(2)}`, 'Cost']} />
        <Area
          type="monotone"
          dataKey="cost"
          stroke="#6366f1"
          fill="#6366f1"
          fillOpacity={0.15}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function CostDashboardPage(): JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ['metering-summary'],
    queryFn: fetchCostSummary,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Failed to load cost data: {String(error)}
        </div>
      </div>
    );
  }

  const summary = data as CostSummary;
  const percentUsed = budgetPercentUsed(summary.budget_total, summary.budget_remaining);
  const isBudgetWarning = percentUsed >= 80;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Cost Dashboard</h1>
          <p className="text-sm text-muted">Track spending across workflows and models.</p>
        </div>
        {isBudgetWarning && (
          <Badge variant="destructive" className="flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5" />
            Budget {percentUsed}% used
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard icon={DollarSign} label="Today" value={formatCurrency(summary.today)} />
        <KpiCard icon={DollarSign} label="This Week" value={formatCurrency(summary.this_week)} />
        <KpiCard icon={DollarSign} label="This Month" value={formatCurrency(summary.this_month)} />
        <KpiCard
          icon={TrendingUp}
          label="Budget Remaining"
          value={formatCurrency(summary.budget_remaining)}
          warning={isBudgetWarning}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <DollarSign className="h-4 w-4" />
              Cost by Workflow
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CostByWorkflowChart data={summary.by_workflow ?? []} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <PieChart className="h-4 w-4" />
              Cost by Model
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CostByModelChart data={summary.by_model ?? []} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4" />
            Daily Cost Trend (Last 30 Days)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DailyTrendChart data={summary.daily_trend ?? []} />
        </CardContent>
      </Card>
    </div>
  );
}
