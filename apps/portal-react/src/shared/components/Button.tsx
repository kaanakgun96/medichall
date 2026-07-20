import type { ButtonHTMLAttributes, PropsWithChildren } from "react";

type ButtonProps = PropsWithChildren<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    tone?: "primary" | "secondary" | "quiet" | "danger";
    size?: "small" | "medium";
  }
>;

export function Button({
  children,
  className = "",
  tone = "secondary",
  size = "medium",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`button button--${tone} button--${size} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}
