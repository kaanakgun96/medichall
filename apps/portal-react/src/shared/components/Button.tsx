import type { ButtonHTMLAttributes, PropsWithChildren } from "react";

type ButtonProps = PropsWithChildren<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    tone?: "primary" | "secondary" | "quiet" | "danger" | "success";
    size?: "small" | "medium" | "large";
    loading?: boolean;
  }
>;

export function Button({
  children,
  className = "",
  tone = "secondary",
  size = "medium",
  loading = false,
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`button button--${tone} button--${size} ${loading ? "is-loading" : ""} ${className}`.trim()}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      {...props}
    >
      {children}
    </button>
  );
}
