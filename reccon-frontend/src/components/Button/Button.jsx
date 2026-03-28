import "./Button.css";

export function Button({
  children,
  variant = "primary",
  disabled = false,
  className = "",
  type = "button", 
  ...props
}) {
  return (
    <button
    type={type}    
      className={`btn btn--${variant} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}
