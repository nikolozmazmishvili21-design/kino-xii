import { useState } from "react";
import FormField from "../components/forms/FormField.jsx";
import AuthFormActions from "./AuthFormActions.jsx";

export default function LoginForm({ onSwitchMode }) {
  const [fields, setFields] = useState({ email: "", password: "" });
  function handleChange(event) {
    setFields((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  return (
    <form className="auth-form" noValidate onSubmit={(event) => event.preventDefault()}>
      <div className="auth-form__fields">
        <FormField label="Email" name="email" type="email" autoComplete="email" placeholder="example@gmail.com" value={fields.email} onChange={handleChange} data-initial-focus />
        <FormField label="Password" name="password" type="password" autoComplete="current-password" placeholder="••••••••" value={fields.password} onChange={handleChange} />
      </div>
      <AuthFormActions mode="login" onSwitchMode={onSwitchMode} />
    </form>
  );
}
