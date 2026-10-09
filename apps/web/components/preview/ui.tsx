'use client';

import { useState, type ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

// Shared pieces for the design previews. All data in the previews is static sample data.

export function PreviewBanner({ phase, note }: { phase: string; note: string }) {
  return (
    <s-banner tone="info" heading={`Design preview: arrives in ${phase}`}>
      <s-paragraph>
        {note} The figures are sample data, not your store, and nothing here is saved.
      </s-paragraph>
    </s-banner>
  );
}

export function Table({
  head,
  rows,
  numeric = [],
}: {
  head: string[];
  rows: ReactNode[][];
  numeric?: number[];
}) {
  return (
    <s-table>
      <s-table-header-row>
        {head.map((h, i) => (
          <s-table-header
            key={h}
            listSlot={i === 0 ? 'primary' : undefined}
            format={numeric.includes(i) ? 'numeric' : undefined}
          >
            {h}
          </s-table-header>
        ))}
      </s-table-header-row>
      <s-table-body>
        {rows.map((r, i) => (
          <s-table-row key={i}>
            {r.map((c, j) => (
              <s-table-cell key={j}>{c}</s-table-cell>
            ))}
          </s-table-row>
        ))}
      </s-table-body>
    </s-table>
  );
}

export function Kpi({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: 'success' | 'critical' | 'neutral';
}) {
  return (
    <s-section>
      <s-stack gap="small-300">
        <s-text color="subdued">{label}</s-text>
        <s-heading>{value}</s-heading>
        {note && <s-text tone={tone}>{note}</s-text>}
      </s-stack>
    </s-section>
  );
}

export function KpiGrid({ children }: { children: ReactNode }) {
  return (
    <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
      {children}
    </s-grid>
  );
}

export function Line_({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <s-stack direction="inline" justifyContent="space-between" gap="base">
      <s-text type={strong ? 'strong' : undefined}>{label}</s-text>
      <s-text type={strong ? 'strong' : undefined}>{value}</s-text>
    </s-stack>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: Array<{ id: T; label: string }>;
  value: T;
  onChange: (t: T) => void;
}) {
  return (
    <s-stack direction="inline" gap="small">
      {tabs.map((t) => (
        <s-button
          key={t.id}
          variant={t.id === value ? 'primary' : 'secondary'}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </s-button>
      ))}
    </s-stack>
  );
}

export function useTab<T extends string>(first: T) {
  return useState<T>(first);
}

const money = (v: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(v);

export function SampleBars({
  data,
  keys,
  height = 260,
}: {
  data: Array<Record<string, string | number>>;
  keys: Array<{ key: string; name: string; color: string }>;
  height?: number;
}) {
  return (
    <div role="img" aria-label="Bar chart with sample data" style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="name" />
          <YAxis tickFormatter={money} width={72} />
          <Tooltip formatter={(v) => money(Number(v))} />
          <Legend />
          {keys.map((k) => (
            <Bar
              key={k.key}
              dataKey={k.key}
              name={k.name}
              fill={k.color}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SampleLines({
  data,
  keys,
  height = 260,
}: {
  data: Array<Record<string, string | number>>;
  keys: Array<{ key: string; name: string; color: string }>;
  height?: number;
}) {
  return (
    <div role="img" aria-label="Line chart with sample data" style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="name" />
          <YAxis tickFormatter={money} width={72} />
          <Tooltip formatter={(v) => money(Number(v))} />
          <Legend />
          {keys.map((k) => (
            <Line
              key={k.key}
              type="monotone"
              dataKey={k.key}
              name={k.name}
              stroke={k.color}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
