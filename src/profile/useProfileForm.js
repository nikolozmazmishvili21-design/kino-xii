import { useEffect, useRef, useState } from "react";
import { updateProfile } from "../api/profileApi.js";
import { useAuth } from "../auth/AuthContext.js";
import { useProfileAccess } from "../auth/ProfileAccessContext.js";
import { PROFILE_FIELDS, validateProfile } from "../validation/profileValidation.js";
import { isProfileDirty, profileDraft } from "./profileForm.js";

function initialState(user) {
  const draft = profileDraft(user);
  return { user, draft, baseline: draft, touched: {}, serverErrors: {},
    feedback: null, pending: false, reauthUserId: null };
}

export default function useProfileForm(venues, formRef) {
  const auth = useAuth();
  const { continuation, reauthenticateProfile } = useProfileAccess();
  const user = auth.status === "authenticated" && auth.mutation !== "logout" ? auth.user : null;
  const [state, setState] = useState(() => initialState(user));
  const mounted = useRef(false);
  const activeRequest = useRef(null);
  const generation = useRef(0);

  // Adjust before children render: another account must never see the old draft.
  if (state.user !== user) {
    if (!user && continuation?.type === "reauth" && continuation.userId === state.user?.id) {
      setState({ ...state, user: null, reauthUserId: state.user.id, pending: false,
        feedback: null, serverErrors: {} });
    } else if (user && continuation?.type === "reauth" && state.reauthUserId === user.id) {
      setState({ ...state, user, baseline: profileDraft(user), pending: false,
        reauthUserId: null, serverErrors: {},
        feedback: { type: "success", message: "Session restored. Review your changes and save again." } });
    } else if (user && state.user?.id === user.id) {
      const next = initialState(user);
      // A guarded same-account server refresh updates pristine fields and the
      // saved baseline. Preserve only genuine unsaved edits, never another account.
      next.draft = Object.fromEntries(Object.entries(next.draft).map(([field, value]) =>
        [field, state.draft[field] !== state.baseline[field] ? state.draft[field] : value]));
      next.touched = state.touched;
      setState(next);
    } else {
      setState(initialState(user));
    }
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    // Cancel the previous account's request on User replacement or unmount.
    return () => {
      generation.current += 1;
      activeRequest.current?.controller.abort();
      activeRequest.current = null;
    };
  }, [user]);

  const errors = validateProfile(state.draft, { venues, baseline: state.baseline });
  const valid = !Object.values(errors).some(Boolean);
  const dirty = isProfileDirty(state.draft, state.baseline);
  const canSave = Boolean(user && dirty && valid && !state.pending && !auth.mutation);

  function change(field, value) {
    if (state.pending) return;
    setState((current) => ({ ...current, draft: { ...current.draft, [field]: value },
      serverErrors: { ...current.serverErrors, [field]: null }, feedback: null }));
  }

  function blur(field) {
    setState((current) => ({ ...current, touched: { ...current.touched, [field]: true } }));
  }

  function focusFirst(fieldErrors, expectedUser) {
    const field = PROFILE_FIELDS.find((name) => fieldErrors[name]);
    if (!field) return;
    requestAnimationFrame(() => {
      if (mounted.current && auth.isCurrentUser(expectedUser)) {
        formRef.current?.elements.namedItem(field)?.focus();
      }
    });
  }

  async function submit(event) {
    event.preventDefault();
    if (activeRequest.current || state.pending || !auth.isCurrentUser(user)) return;
    const submissionErrors = validateProfile(state.draft, { venues, baseline: state.baseline });
    if (Object.values(submissionErrors).some(Boolean)) {
      setState((current) => ({ ...current, touched: Object.fromEntries(PROFILE_FIELDS.map((field) => [field, true])) }));
      focusFirst(submissionErrors, user);
      return;
    }
    if (!dirty) return;

    const request = { id: ++generation.current, controller: new AbortController() };
    activeRequest.current = request;
    const expectedUser = user;
    const replaceUser = auth.replaceUser;
    const isCurrent = () => mounted.current && activeRequest.current === request
      && generation.current === request.id && auth.isCurrentUser(expectedUser);
    setState((current) => ({ ...current, pending: true, serverErrors: {},
      feedback: { type: "saving", message: "Saving profile…" } }));
    try {
      const returnedUser = await updateProfile(state.draft, { signal: request.controller.signal });
      if (!isCurrent()) return;
      if (!replaceUser(returnedUser)) {
        setState((current) => ({ ...current, feedback: { type: "error", message: "Unable to apply the saved profile. Please try again." } }));
        return;
      }
      setState({ ...initialState(returnedUser), feedback: { type: "success", message: "Profile saved successfully." } });
    } catch (error) {
      if (!isCurrent() || error.name === "AbortError") return;
      if (error.status === 401) {
        reauthenticateProfile(expectedUser);
        return;
      }
      const serverErrors = {};
      if (error.status === 422 && error.errors && typeof error.errors === "object") {
        for (const field of PROFILE_FIELDS) {
          const messages = error.errors[field];
          if (Array.isArray(messages) && messages.length) serverErrors[field] = messages;
          else if (typeof messages === "string" && messages) serverErrors[field] = [messages];
        }
      }
      const hasFields = Object.keys(serverErrors).length > 0;
      setState((current) => ({ ...current, serverErrors,
        feedback: { type: "error", message: hasFields ? "Please review the highlighted fields." : error.message || "Unable to save your profile. Please try again." } }));
      if (hasFields) focusFirst(serverErrors, expectedUser);
    } finally {
      if (activeRequest.current === request) {
        activeRequest.current = null;
        if (mounted.current) setState((current) => ({ ...current, pending: false }));
      }
    }
  }

  function fieldProps(field) {
    const error = state.serverErrors[field] || (state.touched[field] && errors[field]);
    return { name: field, value: state.draft[field], error,
      success: Boolean(state.touched[field] && !error && state.draft[field]),
      disabled: state.pending || Boolean(auth.mutation),
      onChange: (event) => change(field, event.target.value), onBlur: () => blur(field) };
  }

  return { ...state, user, canSave, fieldProps, submit };
}
