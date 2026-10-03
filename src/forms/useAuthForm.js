import { useEffect, useRef, useState } from "react";
import { getAuthFormErrors } from "./authFormErrors.js";

// Shared auth-only form lifecycle; API mutations stay in AuthProvider.
export default function useAuthForm({ initialFields, validate, submit, mutation, onSuccess, failureMessage }) {
  const [fields, setFields] = useState(initialFields);
  const [touched, setTouched] = useState({});
  const [serverErrors, setServerErrors] = useState({});
  const [avatarSelectionError, setAvatarSelectionError] = useState(null);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const errorForm = useRef(null);
  const engagedFields = useRef({});

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const form = errorForm.current;
    errorForm.current = null;
    if (!form || !mounted.current) return;
    // Wait for aria-invalid and field messages to be rendered before focusing.
    const control = Array.from(form.elements).find((element) => Object.hasOwn(serverErrors, element.name));
    control?.focus();
  }, [serverErrors]);

  const localErrors = validate(fields);
  const valid = !Object.values(localErrors).some(Boolean);
  const pending = submitting || mutation !== null;

  function changeField(name, value, selectionError = null) {
    if (inFlight.current || mutation !== null) return;
    engagedFields.current[name] = true;
    setFields((current) => ({ ...current, [name]: value }));
    setServerErrors((current) => ({ ...current, [name]: undefined }));
    setMessage("");
    if (name === "avatar") {
      setTouched((current) => ({ ...current, avatar: true }));
      setAvatarSelectionError(selectionError);
    }
  }

  function handleChange(event) {
    changeField(event.target.name, event.target.value);
  }

  function handleEngagement(event) {
    engagedFields.current[event.currentTarget.name] = true;
  }

  function handleBlur(event) {
    // A window/tab blur has no next control and is not form navigation.
    if (!event.relatedTarget && !document.hasFocus()) return;
    const { name } = event.target;
    // Initial programmatic focus does not count as interacting with an empty field.
    if (!engagedFields.current[name] && !fields[name]) return;
    setTouched((current) => ({ ...current, [name]: true }));
  }

  function fieldProps(name) {
    const error = serverErrors[name] || (touched[name] ? localErrors[name] : null);
    return {
      value: fields[name],
      onChange: handleChange,
      onBlur: handleBlur,
      onPointerDown: handleEngagement,
      onKeyDown: handleEngagement,
      readOnly: pending,
      required: true,
      error,
      success: Boolean(touched[name] && !localErrors[name] && !serverErrors[name]),
    };
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (inFlight.current || mutation !== null) return;
    const submittedForm = event.currentTarget;

    const errors = validate(fields);
    setTouched(Object.fromEntries(Object.keys(fields).map((name) => [name, true])));
    if (Object.values(errors).some(Boolean)) {
      const invalidName = Object.keys(errors).find((name) => errors[name]);
      event.currentTarget.elements.namedItem(invalidName)?.focus();
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    errorForm.current = null;
    setServerErrors({});
    setMessage("");

    let user;
    try {
      user = await submit(fields);
    } catch (error) {
      if (mounted.current) {
        const feedback = getAuthFormErrors(error, Object.keys(fields), failureMessage);
        errorForm.current = Object.keys(feedback.fieldErrors).length ? submittedForm : null;
        setServerErrors(feedback.fieldErrors);
        setMessage(feedback.message);
      }
      return;
    } finally {
      inFlight.current = false;
      if (mounted.current) setSubmitting(false);
    }

    // AppShell's stable close callback closes whichever auth modal is now open.
    onSuccess?.(user);
  }

  return {
    fields,
    fieldProps,
    changeField,
    handleSubmit,
    pending,
    valid,
    message,
    avatarError: serverErrors.avatar || avatarSelectionError || (touched.avatar ? localErrors.avatar : null),
  };
}
