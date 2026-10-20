import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  LineChart,
  PieChart,
  SlidersHorizontal,
  TrendingUp
} from 'lucide-react';
import { Transaction } from '../types/finance';
import { formatIDR } from '../lib/supabase';

export interface CategoryExpenseStat {
  categoryId: string;
  budgetId: string | null;
  name: string;
  color: string;
  amount: number;
  percentage: number;
  budgetLimit: number | null;
  alertThreshold: number;
  budgetRatio: number | null;
  safeDailyAllowance: number | null;
  isOverThreshold: boolean;
  isPaceWarning: boolean;
}

interface CashFlowChartProps {
  monthlyTransactions: Transaction[];
  expenseByCategory: CategoryExpenseStat[];
  savingsRatePct: number;
  onOpenBudgets: () => void;
}

const BUCKET_LABELS = ['1–5', '6–10', '11–15', '16–20', '21–25', '26–31'];

export const CashFlowChart: React.FC<CashFlowChartProps> = ({
  monthlyTransactions,
  expenseByCategory,
  savingsRatePct,
  onOpenBudgets
}) => {
  const [isDetailsExpanded, setIsDetailsExpanded] = useState<boolean>(false);
  const [selectedPointIdx, setSelectedPointIdx] = useState<number | null>(null);
  const detailsContainerRef = useRef<HTMLDivElement | null>(null);

  const activeCategoryItems = useMemo(
    () => expenseByCategory.filter((item) => item.amount > 0),
    [expenseByCategory]
  );

  // Aggregate transactions into 6 5-day period buckets for the Line Chart
  const lineSeries = useMemo(() => {
    const incomeBuckets = [0, 0, 0, 0, 0, 0];
    const expenseBuckets = [0, 0, 0, 0, 0, 0];

    for (const tx of monthlyTransactions) {
      const dayPart = Number(tx.transaction_date.slice(8, 10)) || 1;
      const bucketIdx = Math.min(Math.floor((dayPart - 1) / 5), 5);
      if (tx.type === 'income') {
        incomeBuckets[bucketIdx] += Number(tx.amount);
      } else {
        expenseBuckets[bucketIdx] += Number(tx.amount);
      }
    }

    const maxVal = Math.max(...incomeBuckets, ...expenseBuckets, 100000);
    return {
      incomeBuckets,
      expenseBuckets,
      maxVal
    };
  }, [monthlyTransactions]);

  // SVG coordinate helper (viewBox 360 x 140)
  const chartWidth = 360;
  const chartHeight = 135;
  const padX = 24;
  const padY = 18;
  const usableW = chartWidth - padX * 2;
  const usableH = chartHeight - padY * 2;

  const getPoints = (values: number[]) =>
    values.map((val, idx) => {
      const x = padX + (idx / (values.length - 1)) * usableW;
      const y = padY + usableH - (val / lineSeries.maxVal) * usableH;
      return { x, y, val };
    });

  const expensePoints = getPoints(lineSeries.expenseBuckets);
  const incomePoints = getPoints(lineSeries.incomeBuckets);

  const toPolyline = (pts: Array<{ x: number; y: number }>) =>
    pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  const toAreaPath = (pts: Array<{ x: number; y: number }>) => {
    if (pts.length === 0) return '';
    const baselineY = padY + usableH;
    const linePart = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    return `${linePart} L ${pts[pts.length - 1].x.toFixed(1)} ${baselineY} L ${pts[0].x.toFixed(1)} ${baselineY} Z`;
  };

  const handleToggleDetails = () => {
    const next = !isDetailsExpanded;
    if (next && detailsContainerRef.current) {
      detailsContainerRef.current.hidden = false;
    }
    setIsDetailsExpanded(next);
  };

  const handleTransitionEnd = (e: React.TransitionEvent<HTMLDivElement>) => {
    if (e.propertyName === 'block-size' && !isDetailsExpanded && detailsContainerRef.current) {
      detailsContainerRef.current.hidden = true;
    }
  };

  return (
    <div className="lg:col-span-6 rounded-2xl bg-white p-5 sm:p-6 border border-slate-200/80 shadow-sm flex flex-col justify-between">
      <div>
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm sm:text-base font-bold text-slate-900 flex items-center gap-2">
              <LineChart className="h-4 w-4 text-indigo-600" />
              Grafik Tren & Distribusi Pengeluaran
            </h3>
            <p className="text-xs text-slate-500">
              Tren arus kas per periode tanggal &amp; proporsi kategori
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenBudgets}
            title="Atur Budget"
            aria-label="Atur Budget"
            className="p-1.5 text-slate-400 hover:text-indigo-600 transition-colors cursor-pointer shrink-0"
          >
            <SlidersHorizontal className="h-5 w-5" />
          </button>
        </div>

        {/* SVG Line Chart: Tren Pemasukan vs Pengeluaran */}
        <div className="rounded-xl bg-slate-50/80 border border-slate-100 p-3.5 mt-2">
          <div className="flex items-center justify-between text-[11px] mb-2">
            <span className="font-semibold text-slate-600">Tren Arus Kas Bulan Ini (Tgl 1–31)</span>
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                <span className="h-2 w-2 rounded-full bg-emerald-500" /> Pemasukan
              </span>
              <span className="inline-flex items-center gap-1 text-rose-700 font-medium">
                <span className="h-2 w-2 rounded-full bg-rose-500" /> Pengeluaran
              </span>
            </div>
          </div>

          <svg
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            className="w-full h-36 overflow-visible select-none"
            role="img"
            aria-label="Grafik garis tren pemasukan dan pengeluaran bulanan"
          >
            <defs>
              <linearGradient id="incomeAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity="0.24" />
                <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
              </linearGradient>
              <linearGradient id="expenseAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.22" />
                <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Horizontal Grid Lines */}
            {[0, 0.5, 1].map((step, i) => {
              const y = padY + step * usableH;
              return (
                <line
                  key={i}
                  x1={padX}
                  y1={y}
                  x2={chartWidth - padX}
                  y2={y}
                  stroke="#e2e8f0"
                  strokeDasharray="3 3"
                  strokeWidth="1"
                />
              );
            })}

            {/* Area under lines */}
            <path d={toAreaPath(incomePoints)} fill="url(#incomeAreaGrad)" />
            <path d={toAreaPath(expensePoints)} fill="url(#expenseAreaGrad)" />

            {/* Income Line */}
            <polyline
              fill="none"
              stroke="#10b981"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={toPolyline(incomePoints)}
            />

            {/* Expense Line */}
            <polyline
              fill="none"
              stroke="#f43f5e"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={toPolyline(expensePoints)}
            />

            {/* Interactive Data Points & Date Bucket Labels */}
            {BUCKET_LABELS.map((label, idx) => {
              const incPt = incomePoints[idx];
              const expPt = expensePoints[idx];
              const isSelected = selectedPointIdx === idx;

              return (
                <g
                  key={label}
                  className="cursor-pointer"
                  onClick={() => setSelectedPointIdx(isSelected ? null : idx)}
                >
                  <circle
                    cx={incPt.x}
                    cy={incPt.y}
                    r={isSelected ? 5 : 3.5}
                    fill="#ffffff"
                    stroke="#10b981"
                    strokeWidth="2.5"
                  />
                  <circle
                    cx={expPt.x}
                    cy={expPt.y}
                    r={isSelected ? 5 : 3.5}
                    fill="#ffffff"
                    stroke="#f43f5e"
                    strokeWidth="2.5"
                  />
                  <text
                    x={incPt.x}
                    y={chartHeight - 2}
                    textAnchor="middle"
                    className="fill-slate-400 text-[9px] font-medium"
                  >
                    Tgl {label}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* Selected Point Tooltip Info */}
          {selectedPointIdx !== null && (
            <div className="mt-2 pt-2 border-t border-slate-200/70 flex items-center justify-between text-[11px]">
              <span className="font-semibold text-slate-700">
                Periode Tgl {BUCKET_LABELS[selectedPointIdx]}:
              </span>
              <div className="flex items-center gap-3">
                <span className="text-emerald-600 font-bold">
                  +{formatIDR(lineSeries.incomeBuckets[selectedPointIdx])}
                </span>
                <span className="text-rose-600 font-bold">
                  -{formatIDR(lineSeries.expenseBuckets[selectedPointIdx])}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Stacked Category Bar + Collapsible Details Toggle */}
        {activeCategoryItems.length > 0 ? (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-slate-600 mb-1.5">
              <span className="font-semibold flex items-center gap-1.5">
                <PieChart className="h-3.5 w-3.5 text-indigo-500" />
                Proporsi {activeCategoryItems.length} Kategori Pengeluaran
              </span>
              <button
                type="button"
                aria-expanded={isDetailsExpanded}
                aria-controls="chart-category-details"
                onClick={handleToggleDetails}
                className="inline-flex items-center gap-1 rounded-lg bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 px-2.5 py-1 text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
              >
                <span>{isDetailsExpanded ? 'Sembunyikan Rincian' : 'Lihat Rincian'}</span>
                {isDetailsExpanded ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>
            </div>

            {/* Compact Multi-Segment Bar */}
            <div className="h-3.5 w-full rounded-full bg-slate-100 overflow-hidden flex gap-0.5 p-0.5">
              {activeCategoryItems.map((item) => (
                <div
                  key={item.categoryId}
                  style={{
                    width: `${Math.max(item.percentage, 3)}%`,
                    backgroundColor: item.color
                  }}
                  className="h-full first:rounded-l-full last:rounded-r-full transition-all duration-300"
                  title={`${item.name}: ${formatIDR(item.amount)} (${item.percentage}%)`}
                />
              ))}
            </div>

            {/* Compact Pill Legend when collapsed */}
            {!isDetailsExpanded && (
              <div className="flex flex-wrap gap-2 mt-2.5">
                {activeCategoryItems.slice(0, 4).map((item) => (
                  <span
                    key={item.categoryId}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 border border-slate-200/70 px-2 py-1 text-[11px] text-slate-700"
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="font-medium">{item.name}</span>
                    <span className="text-slate-400">{item.percentage}%</span>
                  </span>
                ))}
              </div>
            )}

            {/* Collapsible Detailed Category Breakdown (animate-to-intrinsic-sizes) */}
            <div
              id="chart-category-details"
              ref={detailsContainerRef}
              onTransitionEnd={handleTransitionEnd}
              className={`expandable-container ${isDetailsExpanded ? 'is-expanded' : ''}`}
            >
              <div className="space-y-3.5 pt-4">
                {activeCategoryItems.map((item) => (
                  <div key={item.categoryId} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs sm:text-sm">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: item.color }}
                        />
                        <span className="font-medium text-slate-800">{item.name}</span>
                        <span className="text-xs text-slate-400">({item.percentage}%)</span>
                        {item.isOverThreshold && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 border border-amber-200">
                            <AlertTriangle className="h-2.5 w-2.5" />
                            {item.budgetRatio}% Kuota
                          </span>
                        )}
                      </div>
                      <span className="font-bold text-slate-900">{formatIDR(item.amount)}</span>
                    </div>

                    <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.min(item.budgetRatio ?? item.percentage, 100)}%`,
                          backgroundColor: item.isOverThreshold ? '#f59e0b' : item.color
                        }}
                      />
                    </div>

                    {item.budgetLimit && (
                      <p className="text-[11px] text-slate-400 flex justify-between">
                        <span>Batas Anggaran: {formatIDR(item.budgetLimit)}</span>
                        <span>Aman Harian: {formatIDR(item.safeDailyAllowance || 0)}/hari</span>
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="py-8 text-center text-slate-400 text-xs">
            Belum ada pengeluaran tercatat di bulan ini.
          </div>
        )}
      </div>

      <div className="mt-5 pt-3.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <TrendingUp className="h-4 w-4 text-emerald-600" />
          Rasio Tabungan Bulan Ini
        </span>
        <span className="font-bold text-slate-800">{savingsRatePct}%</span>
      </div>
    </div>
  );
};

