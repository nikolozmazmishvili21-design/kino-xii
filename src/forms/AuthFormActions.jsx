export default function AuthFormActions({ mode, onSwitchMode }) {
  const isSignup = mode === "signup";
  return (
    <div className="auth-form__actions">
      <button type="submit" className="button button--primary auth-form__submit" disabled>{isSignup ? "Sign up" : "Log in"}</button>
      <p className="auth-form__switch">
        <span>{isSignup ? "Already have an account?" : "Don't have an account?"}</span>
        <button type="button" className="text-action" onClick={() => onSwitchMode(isSignup ? "login" : "signup")}>{isSignup ? "Log in" : "Sign up"}</button>
      </p>
    </div>
  );
}
