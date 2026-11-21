import React, { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { toJsDate } from '../lib/firebase';
import { formatCurrency } from '../lib/formatters';
import type { Expense, Sale } from '../types/pos';

interface ProfitTrendChartProps {
  sales: Sale[];
  expenses: Expense[];
  onRefresh?: () => void;
  loading?: boolean;
}

type TrendMode = 'weekly' | 'monthly' | 'yearly';

interface PeriodBucket {
  start: Date;
  end: Date;
  label: string;
  gross: number;
  expenses: number;
  sales: number;
  net: number;
}

export const ProfitTrendChart: React.FC<ProfitTrendChartProps> = ({
  sales,
  expenses,
  onRefresh,
  loading = false,
}) => {
  const [mode, setMode] = useState<TrendMode>('monthly');
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const periods = useMemo<PeriodBucket[]>(() => {
    const now = new Date();
    const list: PeriodBucket[] = [];

    if (mode === 'weekly') {
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const day = (monday.getDay() + 6) % 7;
      monday.setDate(monday.getDate() - day);
      for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        list.push({
          start: d,
          end: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1),
          label: d.toLocaleDateString('en-KE', { weekday: 'short' }),
          gross: 0,
          expenses: 0,
          sales: 0,
          net: 0,
        });
      }
    } else if (mode === 'yearly') {
      for (let i = 0; i < 12; i++) {
        const start = new Date(now.getFullYear(), i, 1);
        list.push({
          start,
          end: new Date(now.getFullYear(), i + 1, 1),
          label: start.toLocaleDateString('en-KE', { month: 'short' }),
          gross: 0,
          expenses: 0,
          sales: 0,
          net: 0,
        });
      }
    } else {
      const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      for (let i = 1; i <= days; i++) {
        const start = new Date(now.getFullYear(), now.getMonth(), i);
        list.push({
          start,
          end: new Date(now.getFullYear(), now.getMonth(), i + 1),
          label: String(i),
          gross: 0,
          expenses: 0,
          sales: 0,
          net: 0,
        });
      }
    }

    sales.forEach((sale) => {
      const date = toJsDate(sale.date);
      if (!date) return;
      const bucket = list.find((p) => date >= p.start && date < p.end);
      if (bucket) {
        bucket.gross += Number(sale.profit) || 0;
        bucket.sales += Number(sale.total) || 0;
      }
    });

    expenses.forEach((exp) => {
      const date = toJsDate(exp.date);
      if (!date) return;
      const bucket = list.find((p) => date >= p.start && date < p.end);
      if (bucket) {
        bucket.expenses += Number(exp.amount) || 0;
      }
    });

    list.forEach((p) => {
      p.net = p.gross - p.expenses;
    });

    return list;
  }, [sales, expenses, mode]);

  const totalGross = periods.reduce((s, p) => s + p.gross, 0);
  const totalExpenses = periods.reduce((s, p) => s + p.expenses, 0);
  const totalNet = totalGross - totalExpenses;

  // SVG chart dimensions
  const width = 820;
  const height = 280;
  const pad = { left: 72, right: 20, top: 20, bottom: 38 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const values = periods.map((p) => p.net);
  const all = values.concat([0]);
  let min = Math.min(...all);
  let max = Math.max(...all);
  if (min === max) {
    min -= 100;
    max += 100;
  }
  const span = max - min;
  min -= span * 0.12;
  max += span * 0.12;

  const getY = (v: number) => pad.top + ((max - v) / (max - min)) * plotH;
  const step = periods.length > 1 ? plotW / (periods.length - 1) : plotW / 2;
  const getX = (i: number) => pad.left + (periods.length > 1 ? i * step : plotW / 2);

  const pathD = periods
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${getX(i).toFixed(1)} ${getY(p.net).toFixed(1)}`)
    .join(' ');

  const zeroY = getY(0);
  const labelEvery = Math.max(1, Math.ceil(periods.length / 12));

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900">Profit Trends</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Net profit equals recorded sales profit minus recorded expenses.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(['weekly', 'monthly', 'yearly'] as TrendMode[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setMode(item)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap capitalize ${
                  mode === item
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {item}
              </button>
            ))}
          </div>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="h-9 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>Refresh</span>
            </button>
          )}
        </div>
      </div>

      <div className="relative w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto min-w-[540px]"
          role="img"
          aria-label="Profit trend chart"
        >
          {/* Horizontal grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((t, idx) => {
            const val = min + (max - min) * t;
            const yy = getY(val);
            return (
              <g key={idx}>
                <line
                  x1={pad.left}
                  y1={yy}
                  x2={width - pad.right}
                  y2={yy}
                  stroke="#e2e8f0"
                  strokeWidth={1}
                />
                <text
                  x={pad.left - 10}
                  y={yy + 4}
                  textAnchor="end"
                  className="fill-slate-500 text-[11px] font-mono"
                >
                  {Math.round(val).toLocaleString('en-KE')}
                </text>
              </g>
            );
          })}

          {/* Zero baseline */}
          <line
            x1={pad.left}
            y1={zeroY}
            x2={width - pad.right}
            y2={zeroY}
            stroke="#94a3b8"
            strokeWidth={1}
            strokeDasharray="4 4"
          />

          {/* Trend path */}
          {periods.length > 0 && (
            <path
              d={pathD}
              fill="none"
              stroke="#1457c5"
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}

          {/* Points and labels */}
          {periods.map((p, i) => {
            const xx = getX(i);
            const yy = getY(p.net);
            const isHovered = hoveredIdx === i;
            const showLabel = i % labelEvery === 0 || i === periods.length - 1;
            return (
              <g key={p.label + i}>
                {showLabel && (
                  <text
                    x={xx}
                    y={height - 12}
                    textAnchor="middle"
                    className="fill-slate-500 text-[11px]"
                  >
                    {p.label}
                  </text>
                )}
                <circle
                  cx={xx}
                  cy={yy}
                  r={isHovered ? 6 : 3.5}
                  fill={p.net < 0 ? '#dc2626' : '#1457c5'}
                  className="transition-all cursor-pointer"
                  onMouseEnter={() => setHoveredIdx(i)}
                  onMouseLeave={() => setHoveredIdx(null)}
                />
              </g>
            );
          })}
        </svg>

        {hoveredIdx !== null && periods[hoveredIdx] && (
          <div className="mt-2 px-3 py-2 rounded-lg bg-slate-900 text-white text-xs flex flex-wrap items-center gap-4">
            <span className="font-semibold">Period: {periods[hoveredIdx].label}</span>
            <span className="font-mono tabular-nums">
              Sales: {formatCurrency(periods[hoveredIdx].sales)}
            </span>
            <span className="font-mono tabular-nums">
              Gross: {formatCurrency(periods[hoveredIdx].gross)}
            </span>
            <span className="font-mono tabular-nums">
              Expenses: {formatCurrency(periods[hoveredIdx].expenses)}
            </span>
            <span className="font-mono tabular-nums font-semibold">
              Net: {formatCurrency(periods[hoveredIdx].net)}
            </span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-100">
        <div className="px-3.5 py-2.5 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between">
          <span className="text-xs text-slate-600">Gross Profit</span>
          <span className="text-sm font-semibold text-slate-900 font-mono tabular-nums">
            {formatCurrency(totalGross)}
          </span>
        </div>
        <div className="px-3.5 py-2.5 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between">
          <span className="text-xs text-slate-600">Recorded Expenses</span>
          <span className="text-sm font-semibold text-slate-900 font-mono tabular-nums">
            {formatCurrency(totalExpenses)}
          </span>
        </div>
        <div className="px-3.5 py-2.5 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between">
          <span className="text-xs text-slate-600">Net Profit</span>
          <span
            className={`text-sm font-semibold font-mono tabular-nums ${
              totalNet < 0 ? 'text-red-700' : 'text-emerald-700'
            }`}
          >
            {formatCurrency(totalNet)}
          </span>
        </div>
      </div>
    </div>
  );
};
