import "./Input.css";

export function Input({
  state = "default",
  helperText = "",
  className = "",
  ...props
}) {
  const hasError = state === "error";

  return (
    <div className={`inputWrap ${className}`}>
      <input
        className={`input input--${state}`}
        aria-invalid={hasError ? "true" : "false"}
        {...props}
      />
      {helperText ? (
        <div className={`helper ${hasError ? "helper--error" : ""}`}>
          {helperText}
        </div>
      ) : null}
    </div>
  );
}
