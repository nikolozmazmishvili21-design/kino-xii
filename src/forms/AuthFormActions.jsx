export default function AuthFormActions({ mode, onSwitchMode, disabled = true, pending = false, message }) {
  const isSignup = mode === "signup";
  return (
    <div className="auth-form__actions">
      {message && <p className="auth-form__error" role="alert">{(Array.isArray(message) ? message : [message]).map((text, index) => <span className="form-field__error-message" key={index}>{text}</span>)}</p>}
      <button type="submit" className="button button--primary auth-form__submit" disabled={disabled || pending}>
        {pending ? (isSignup ? "Signing up…" : "Logging in…") : (isSignup ? "Sign up" : "Log in")}
      </button>
      <p className="auth-form__switch">
        <span>{isSignup ? "Already have an account?" : "Don't have an account?"}</span>
        <button type="button" className="text-action" onPointerDown={(event) => { if (event.button === 0) event.preventDefault(); }} onClick={() => onSwitchMode(isSignup ? "login" : "signup")}>{isSignup ? "Log in" : "Sign up"}</button>
      </p>
    </div>
  );
}
