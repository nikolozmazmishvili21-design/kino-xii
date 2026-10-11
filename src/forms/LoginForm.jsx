import { useId } from "react";
import { useAuth } from "../auth/AuthContext.js";
import FormField from "../components/forms/FormField.jsx";
import { validateLogin } from "../validation/authValidation.js";
import AuthFormActions from "./AuthFormActions.jsx";
import useAuthForm from "./useAuthForm.js";

export default function LoginForm({ onSwitchMode, onSuccess }) {
  const errorId = useId();
  const { login, mutation } = useAuth();
  const form = useAuthForm({
    initialFields: { email: "", password: "" },
    validate: validateLogin,
    submit: login,
    mutation,
    onSuccess,
    failureMessage: "Unable to log in right now. Please try again.",
    feedbackOnSubmit: true,
    indicateAuthRejection: true,
  });

  return (
    <form className="auth-form" noValidate onSubmit={form.handleSubmit} aria-busy={form.pending}>
      <div className="auth-form__fields">
        <FormField label="Email" name="email" type="email" autoComplete="email" placeholder="example@gmail.com" {...form.fieldProps("email")} data-initial-focus />
        <FormField label="Password" name="password" type="password" autoComplete="current-password" placeholder="••••••••" {...form.fieldProps("password")} />
      </div>
      <AuthFormActions mode="login" onSwitchMode={onSwitchMode} disabled={false} pending={form.pending} message={form.message} messageId={errorId} showErrorIcon={form.authRejected} />
    </form>
  );
}
