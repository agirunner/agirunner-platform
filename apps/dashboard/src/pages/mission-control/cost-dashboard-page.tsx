import { useQuery } from '@tanstack/react-query';
import type { ElementType } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, AlertTriangle, DollarSign, TrendingUp, PieChart, ArrowRight } from 'lucide-react';
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
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Badge } from '../../components/ui/badge.js';
import {
  buildCostPosture,
  budgetPercentUsed,
  formatCurrency,
  type CostSummaryRecord,
} from './cost-dashboard-page.support.js';

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

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

async function fetchCostSummary(): Promise<CostSummaryRecord> {
  const response = await fetch(`${API_BASE_URL}/api/v1/metering/summary`, {
    headers: authHeaders(),
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const body = await response.json();
  return (body.data ?? body) as CostSummaryRecord;
}

function PostureCard({
  label,
  value,
  detail,
  icon: Icon,
  warning,
}: {
  label: string;
  value: string;
  detail: string;
  icon: ElementType;
  warning?: boolean;
}): JSX.Element {
  return (
    <Card className="border-border/70 bg-card/80 shadow-none">
      <CardContent className="space-y-2 p-4">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
          <Icon className="h-4 w-4" />
          {label}
        </div>
        <p className={`text-lg font-semibold ${warning ? 'text-red-600' : ''}`}>
          {value}
        </p>
        <p className="text-sm leading-6 text-muted">{detail}</p>
      </CardContent>
    </Card>
  );
}

function CostByWorkflowChart({ data }: { data: Array<{ name: string; cost: number }> }): JSX.Element {
  if (data.length === 0) {
    return <p className="py-4 text-center text-sm text-muted-foreground">No board cost data.</p>;
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
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ['metering-summary'],
    queryFn: fetchCostSummary,
  });
  const summary = data as CostSummaryRecord | undefined;
  const percentUsed = summary
    ? budgetPercentUsed(summary.budget_total, summary.budget_remaining)
    : 0;
  const isBudgetWarning = percentUsed >= 80;
  const posture = summary ? buildCostPosture(summary) : null;

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
          Failed to load operator cost signals: {String(error)}
        </div>
      </div>
    );
  }
  if (!summary || !posture) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-border/70 bg-card/80 p-4 text-sm text-muted">
          Cost telemetry is not available yet.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
            Mission control operator surface
          </p>
          <h1 className="text-2xl font-semibold">Operator Cost Dashboard</h1>
          <p className="text-sm text-muted">
            Track spend across active boards, work-item execution, and model usage.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isBudgetWarning ? (
            <Badge variant="destructive" className="flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              Budget {percentUsed}% used
            </Badge>
          ) : null}
          <Button
            size="sm"
            onClick={() => navigate('/mission-control/live')}
            className="gap-2"
          >
            Open live board
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Card className="border-border/70 bg-card/80 shadow-none">
        <CardHeader className="space-y-2">
          <CardTitle className="text-base">{posture?.heading ?? 'Spend posture'}</CardTitle>
          <p className="text-sm leading-6 text-muted">{posture?.detail ?? ''}</p>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="rounded-xl border border-border/70 bg-background/70 p-3 text-sm leading-6 text-muted">
            <span className="font-medium text-foreground">Best next step:</span>{' '}
            {posture?.nextAction ?? ''}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <PostureCard icon={DollarSign} {...posture.packets[0]!} />
            <PostureCard icon={TrendingUp} {...posture.packets[1]!} />
            <PostureCard icon={DollarSign} {...posture.packets[2]!} />
            <PostureCard icon={PieChart} {...posture.packets[3]!} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <DollarSign className="h-4 w-4" />
              Cost by Board
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
              Cost by Model Family
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
            Daily Board Spend Trend (Last 30 Days)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DailyTrendChart data={summary.daily_trend ?? []} />
        </CardContent>
      </Card>
    </div>
  );
}
