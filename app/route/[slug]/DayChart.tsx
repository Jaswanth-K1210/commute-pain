"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export default function DayChart({ data }: { data: { t: string; min: number }[] }) {
  if (!data.length) return <p className="py-8 text-center text-mute">collecting data… no full slots for today yet.</p>;
  return (
    <div className="h-48">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, left: -24, bottom: 0 }}>
          <XAxis dataKey="t" tick={{ fontSize: 14, fill: "#6f6688" }} interval="preserveStartEnd" tickLine={false} />
          <YAxis tick={{ fontSize: 14, fill: "#6f6688" }} tickLine={false} axisLine={false} />
          <Tooltip
            cursor={{ fill: "#2b234012" }}
            formatter={(v) => [`${v} min`, "median"]}
            contentStyle={{ border: "3px solid #2b2340", borderRadius: 6, boxShadow: "3px 3px 0 #2b2340" }}
          />
          <Bar isAnimationActive={false} dataKey="min" fill="#d8c8ff" stroke="#2b2340" strokeWidth={2} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
