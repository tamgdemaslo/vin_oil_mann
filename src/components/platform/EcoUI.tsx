import type { ComponentPropsWithoutRef, ReactNode } from "react";

export type EcoBadgeTone = "neutral" | "rust" | "success" | "warning" | "danger" | "info";

export type EcoKpiProps = {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: EcoBadgeTone;
  className?: string;
};

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function EcoButton({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ComponentPropsWithoutRef<"button"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
}) {
  return (
    <button
      className={cx("eco-btn", `eco-btn--${variant}`, size === "sm" && "eco-btn--sm", className)}
      {...props}
    />
  );
}

export function EcoCard({
  padded = true,
  className,
  ...props
}: ComponentPropsWithoutRef<"section"> & { padded?: boolean }) {
  return <section className={cx("eco-card", padded && "eco-card--padded", className)} {...props} />;
}

export function EcoBadge({
  tone = "neutral",
  children,
  className,
  dot = false,
}: {
  tone?: EcoBadgeTone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span className={cx("eco-badge", `eco-badge--${tone}`, className)}>
      {dot && <EcoStatusDot tone={tone} />}
      {children}
    </span>
  );
}

export function EcoStatusDot({
  tone = "neutral",
  pulse = false,
}: {
  tone?: EcoBadgeTone;
  pulse?: boolean;
}) {
  return <span className={cx("eco-dot", `eco-dot--${tone}`, pulse && "eco-dot--pulse")} />;
}

export function EcoKpi({ label, value, sub, tone = "neutral", className }: EcoKpiProps) {
  return (
    <div className={cx("eco-kpi", `eco-kpi--${tone}`, className)}>
      <div className="eco-kpi__label">{label}</div>
      <div className="eco-kpi__value">{value}</div>
      {sub && <div className="eco-kpi__sub">{sub}</div>}
    </div>
  );
}

export function EcoInput({ className, ...props }: ComponentPropsWithoutRef<"input">) {
  return <input className={cx("eco-input", className)} {...props} />;
}

export function EcoSelect({ className, ...props }: ComponentPropsWithoutRef<"select">) {
  return <select className={cx("eco-input", className)} {...props} />;
}

export function EcoTable({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cx("eco-table-wrap", className)}>
      <table className="eco-table">{children}</table>
    </div>
  );
}

