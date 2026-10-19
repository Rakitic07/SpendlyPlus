"use client";

import { useId } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { formatCompact } from "@/lib/utils";
import { useCurrency } from "@/lib/currency";

type Point = { month: string; total: number };

export default function TrendArea({ data }: { data: Point[] }) {
  const { format } = useCurrency();
  // Unique per instance: two charts sharing one gradient id would clash.
  const fillId = `trendFill-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7c8cff" stopOpacity={0.75} />
            <stop offset="100%" stopColor="#7c8cff" stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" vertical={false} />
        <XAxis dataKey="month" tick={{ fill: "rgba(255,255,255,0.6)", fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fill: "rgba(255,255,255,0.6)", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={44}
          tickFormatter={(v) => formatCompact(v as number)}
        />
        <Tooltip
          formatter={(value: number) => [format(value), "Total"]}
          contentStyle={{ color: "#fff" }}
          itemStyle={{ color: "#fff" }}
          labelStyle={{ color: "rgba(255,255,255,0.7)" }}
        />
        <Area
          type="monotone"
          dataKey="total"
          stroke="#a5b4ff"
          strokeWidth={2.5}
          fill={`url(#${fillId})`}
          activeDot={{ r: 5, fill: "#fff" }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
