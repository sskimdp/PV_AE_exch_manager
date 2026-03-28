import "./Chip.css";

export function Chip({ variant = "pending", children, className = "" }) {
  return <span className={`chip chip--${variant} ${className}`}>{children}</span>;
}
