import * as React from "react";

import { cn } from "@/lib/cn";

type ButtonVariant = "primary" | "secondary" | "ghost";
type ButtonSize = "sm" | "md";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "secondary", size = "md", ...props }, ref) => {
    const base =
      "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:pointer-events-none disabled:opacity-50";

    const variants: Record<ButtonVariant, string> = {
      primary:
        "bg-brand-600 text-white shadow-sm hover:bg-brand-700 active:bg-brand-800",
      secondary:
        "bg-white text-slate-900 ring-1 ring-slate-200 hover:bg-slate-50 active:bg-slate-100",
      ghost: "bg-transparent text-slate-700 hover:bg-slate-100 active:bg-slate-200",
    };

    const sizes: Record<ButtonSize, string> = {
      sm: "h-9 px-3",
      md: "h-10 px-4",
    };

    return (
      <button
        ref={ref}
        className={cn(base, variants[variant], sizes[size], className)}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";
