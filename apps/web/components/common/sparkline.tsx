'use client';

import { useId } from 'react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';

/**
 * A small line under a figure, showing its shape over the period. It is decorative: the figure and
 * its change are written next to it, so it is hidden from screen readers. A null point is a gap.
 */
export function Sparkline({
  values,
  color,
  height = '2.75rem',
}: {
  values: Array<number | null>;
  color: string;
  /** CSS height; a table row uses a smaller one */
  height?: string;
}) {
  const gradient = `spark-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  if (values.filter((v) => v !== null).length < 2) return null;
  const data = values.map((v, i) => ({ i, v }));
  return (
    <div aria-hidden="true" style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradient})`}
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
