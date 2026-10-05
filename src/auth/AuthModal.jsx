import { useId } from "react";
import Modal from "../components/Modal.jsx";
import LoginForm from "../forms/LoginForm.jsx";
import SignupForm from "../forms/SignupForm.jsx";
import closeIcon from "../assets/icons/close.svg";

export default function AuthModal({ mode, onSwitchMode, onClose, onSuccess = onClose, openerRef }) {
  const id = useId();
  const isSignup = mode === "signup";

  return (
    <Modal className={`auth-modal auth-modal--${mode}`} labelledBy={`${id}-title`} describedBy={`${id}-description`} onClose={onClose} openerRef={openerRef} focusKey={mode}>
      <div className="auth-modal__header">
        <div className="auth-modal__heading">
          <h2 className="auth-modal__title" id={`${id}-title`}>{isSignup ? "Sign up" : "Log in"}</h2>
          <p className="auth-modal__subtitle" id={`${id}-description`}>{isSignup ? "Welcome to Kino XII" : "Welcome back to Kino XII"}</p>
        </div>
        <button type="button" className="auth-modal__close" onPointerDown={(event) => { if (event.button === 0) event.preventDefault(); }} onClick={onClose} aria-label="Close authentication dialog"><img src={closeIcon} alt="" /></button>
      </div>
      {isSignup ? <SignupForm onSwitchMode={onSwitchMode} onSuccess={onSuccess} /> : <LoginForm onSwitchMode={onSwitchMode} onSuccess={onSuccess} />}
    </Modal>
  );
}
