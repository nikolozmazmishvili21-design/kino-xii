import { useAuth } from "../auth/AuthContext.js";
import FormField from "../components/forms/FormField.jsx";
import AvatarField from "../components/forms/AvatarField.jsx";
import { validateSignup } from "../validation/authValidation.js";
import AuthFormActions from "./AuthFormActions.jsx";
import useAuthForm from "./useAuthForm.js";

export default function SignupForm({ onSwitchMode, onSuccess }) {
  const { register, mutation } = useAuth();
  const form = useAuthForm({
    initialFields: { username: "", email: "", password: "", password_confirmation: "", avatar: null },
    validate: validateSignup,
    submit: register,
    mutation,
    onSuccess,
    failureMessage: "Unable to sign up right now. Please try again.",
  });

  return (
    <form className="auth-form" noValidate onSubmit={form.handleSubmit} aria-busy={form.pending}>
      <AvatarField value={form.fields.avatar} onChange={(file, selectionError) => form.changeField("avatar", file, selectionError)} error={form.avatarError} disabled={form.pending} />
      <div className="auth-form__fields">
        <FormField label="Username" name="username" autoComplete="username" placeholder="User" {...form.fieldProps("username")} data-initial-focus />
        <FormField label="Email" name="email" type="email" autoComplete="email" placeholder="example@gmail.com" {...form.fieldProps("email")} />
        <div className="auth-form__passwords">
          <FormField label="Password" name="password" type="password" autoComplete="new-password" placeholder="••••••••" {...form.fieldProps("password")} />
          <FormField label="Confirm password" name="password_confirmation" type="password" autoComplete="new-password" placeholder="••••••••" {...form.fieldProps("password_confirmation")} />
        </div>
      </div>
      <AuthFormActions mode="signup" onSwitchMode={onSwitchMode} disabled={!form.valid} pending={form.pending} message={form.message} />
    </form>
  );
}
