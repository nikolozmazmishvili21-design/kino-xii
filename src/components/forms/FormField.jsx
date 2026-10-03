import { useId } from "react";
import errorIcon from "../../assets/icons/input-error.svg";
import successIcon from "../../assets/icons/input-success.svg";

// Validation belongs to the feature. This component only presents supplied states.
export default function FormField({ label, error, success = false, helperText, ...inputProps }) {
  const id = useId();
  const helperId = `${id}-helper`;
  const errorId = `${id}-error`;
  const describedBy = [helperText && helperId, error && errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={`form-field${error ? " form-field--error" : ""}${success && !error ? " form-field--success" : ""}`}>
      <label className="form-field__label" htmlFor={id}>{label}</label>
      <div className="form-field__control">
        <input {...inputProps} id={id} className="form-field__input" aria-invalid={error ? true : undefined} aria-describedby={describedBy} />
        {(error || success) && (
          <span className="form-field__icon" aria-hidden="true"><img src={error ? errorIcon : successIcon} alt="" /></span>
        )}
      </div>
      {helperText && <p className="form-field__helper" id={helperId}>{helperText}</p>}
      {error && <p className="form-field__error" id={errorId}>{error}</p>}
    </div>
  );
}
