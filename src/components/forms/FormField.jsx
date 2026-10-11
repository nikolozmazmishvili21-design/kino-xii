import { useId } from "react";
import errorIcon from "../../assets/icons/input-error.svg";
import successIcon from "../../assets/icons/input-success.svg";

// Validation belongs to the feature. This component only presents supplied states.
export default function FormField({ label, error, errorAppearance = false, success = false, successIconSrc = successIcon,
  helperText, as = "input", children, inputRef, ...inputProps }) {
  const id = useId();
  const helperId = `${id}-helper`;
  const errorId = `${id}-error`;
  // A rejected sign-in can look red without claiming this field was incorrect.
  const hasError = Boolean(error || errorAppearance);
  const describedBy = [helperText && helperId, error && errorId, inputProps["aria-describedby"]].filter(Boolean).join(" ") || undefined;

  return (
    <div className={`form-field${hasError ? " form-field--error" : ""}${success && !hasError ? " form-field--success" : ""}`}>
      <label className="form-field__label" htmlFor={id}>{label}</label>
      <div className="form-field__control">
        {as === "select"
          ? <select {...inputProps} ref={inputRef} id={id} className="form-field__input" aria-invalid={error ? true : undefined} aria-describedby={describedBy}>{children}</select>
          : <input {...inputProps} ref={inputRef} id={id} className="form-field__input" aria-invalid={error ? true : undefined} aria-describedby={describedBy} />}
        {(hasError || success) && (
          <span className="form-field__icon" aria-hidden="true"><img src={hasError ? errorIcon : successIconSrc} alt="" /></span>
        )}
      </div>
      {helperText && <p className="form-field__helper" id={helperId}>{helperText}</p>}
      {error && <p className="form-field__error" id={errorId}>{(Array.isArray(error) ? error : [error]).map((message, index) => <span className="form-field__error-message" key={index}>{message}</span>)}</p>}
    </div>
  );
}
