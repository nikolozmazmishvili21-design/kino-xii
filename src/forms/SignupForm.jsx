import { useState } from "react";
import FormField from "../components/forms/FormField.jsx";
import AvatarField from "../components/forms/AvatarField.jsx";
import AuthFormActions from "./AuthFormActions.jsx";

export default function SignupForm({ onSwitchMode }) {
  const [fields, setFields] = useState({ username: "", email: "", password: "", password_confirmation: "" });
  function handleChange(event) {
    setFields((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  return (
    <form className="auth-form" noValidate onSubmit={(event) => event.preventDefault()}>
      <AvatarField />
      <div className="auth-form__fields">
        <FormField label="Username" name="username" autoComplete="username" placeholder="User" value={fields.username} onChange={handleChange} data-initial-focus />
        <FormField label="Email" name="email" type="email" autoComplete="email" placeholder="example@gmail.com" value={fields.email} onChange={handleChange} />
        <div className="auth-form__passwords">
          <FormField label="Password" name="password" type="password" autoComplete="new-password" placeholder="••••••••" value={fields.password} onChange={handleChange} />
          <FormField label="Confirm password" name="password_confirmation" type="password" autoComplete="new-password" placeholder="••••••••" value={fields.password_confirmation} onChange={handleChange} />
        </div>
      </div>
      <AuthFormActions mode="signup" onSwitchMode={onSwitchMode} />
    </form>
  );
}
