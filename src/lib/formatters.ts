import { toJsDate } from './firebase';
import type { BillingCycle } from '../types/pos';

export function formatCurrency(amount: number | undefined | null): string {
  const safe = amount === undefined || amount === null || Number.isNaN(amount) ? 0 : Number(amount);
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    maximumFractionDigits: 2,
  }).format(safe);
}

export function formatDateTime(value: unknown): string {
  const date = toJsDate(value) || new Date();
  return `${date.toLocaleDateString('en-KE')} ${date.toLocaleTimeString('en-KE', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

export function formatShortDate(value: unknown): string {
  const date = toJsDate(value);
  if (!date) return '—';
  return date.toLocaleDateString('en-KE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function getTodayIsoDate(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function addCycleToDate(startIso: string, cycle: BillingCycle): string {
  const base = startIso ? new Date(`${startIso}T00:00:00`) : new Date();
  const next = new Date(base.getTime());
  if (cycle === 'monthly') next.setMonth(next.getMonth() + 1);
  else if (cycle === 'quarterly') next.setMonth(next.getMonth() + 3);
  else if (cycle === 'annual') next.setFullYear(next.getFullYear() + 1);
  else next.setFullYear(next.getFullYear() + 10);
  return next.toISOString().slice(0, 10);
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return map[ch] || ch;
  });
}

export function formatCycleLabel(cycle?: BillingCycle): string {
  switch (cycle) {
    case 'monthly':
      return 'Monthly';
    case 'quarterly':
      return 'Quarterly';
    case 'annual':
      return 'Annual';
    case 'one-time':
      return 'One-Time';
    default:
      return 'Monthly';
  }
}
