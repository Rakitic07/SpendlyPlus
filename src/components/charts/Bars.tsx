"use client";

import { useId } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from "recharts";
import { formatCompact } from "@/lib/utils";
import { useCurrency } from "@/lib/currency";

type Point = { label: string; total: number; color?: string };

export default function Bars({
  data,
  color = "#b06bff",
}: {
  data: Point[];
  color?: string;
}) {
  const { format } = useCurrency();
  // Unique per instance: two charts sharing one gradient id would clash.
  const fillId = `barFill-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.95} />
            <stop offset="100%" stopColor={color} stopOpacity={0.35} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" vertical={false} />
        <XAxis dataKey="label" tick={{ fill: "rgba(255,255,255,0.6)", fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
        <YAxis
          tick={{ fill: "rgba(255,255,255,0.6)", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={44}
          tickFormatter={(v) => formatCompact(v as number)}
        />
        <Tooltip
          cursor={{ fill: "rgba(255,255,255,0.06)" }}
          formatter={(value: number) => [format(value), "Total"]}
          contentStyle={{ color: "#fff" }}
          itemStyle={{ color: "#fff" }}
          labelStyle={{ color: "rgba(255,255,255,0.7)" }}
        />
        <Bar dataKey="total" radius={[8, 8, 0, 0]} fill={`url(#${fillId})`}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.color ?? `url(#${fillId})`} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
