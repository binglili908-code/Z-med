import * as React from "react";

import { cn } from "@/lib/cn";

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "brand" | "teal";
};

export function Badge({ className, tone = "neutral", ...props }: BadgeProps) {
  const tones = {
    neutral: "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200",
    brand: "bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200",
    teal: "bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-200",
  } as const;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-1 text-xs font-medium",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
