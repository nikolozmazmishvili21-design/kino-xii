import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export default function Modal({ children, className = "", labelledBy, describedBy, onClose, openerRef, getFallbackFocus, focusKey }) {
  const dialogRef = useRef(null);
  const pointerStartedOutside = useRef(false);
  const closeRequested = useRef(false);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const opener = openerRef.current;
    closeRequested.current = false;
    dialog.showModal();
    document.body.classList.add("modal-open");
    return () => {
      closeRequested.current = true;
      dialog.close();
      document.body.classList.remove("modal-open");
      // Refund may move its card away; resolve the surviving logical control at close.
      const restore = opener?.isConnected && !opener.disabled ? opener : getFallbackFocus?.();
      if (restore?.isConnected) restore.focus();
    };
  }, [openerRef, getFallbackFocus]);

  useLayoutEffect(() => {
    dialogRef.current.querySelector("[data-initial-focus]")?.focus();
  }, [focusKey]);

  function requestClose() {
    if (closeRequested.current) return;
    closeRequested.current = true;
    onClose();
  }

  function isOutsideDialog(event) {
    const bounds = dialogRef.current.getBoundingClientRect();
    return event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
  }

  function trapFocus(event) {
    if (event.key !== "Tab") return;
    const elements = Array.from(dialogRef.current.querySelectorAll(FOCUSABLE)).filter((element) => element.getClientRects().length > 0);
    const first = elements[0];
    const last = elements.at(-1);
    if (!first) {
      event.preventDefault();
      dialogRef.current.focus();
    } else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <dialog
      ref={dialogRef}
      className={`modal ${className}`}
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      tabIndex={-1}
      onCancel={(event) => { event.preventDefault(); requestClose(); }}
      onClose={(event) => {
        // Ignore a queued close event if Strict Mode has already reopened it.
        if (!event.currentTarget.open) requestClose();
      }}
      onKeyDown={trapFocus}
      onPointerDown={(event) => {
        pointerStartedOutside.current = event.target === event.currentTarget && isOutsideDialog(event);
        // Keep input focus until the backdrop click closes the dialog.
        if (pointerStartedOutside.current && event.button === 0) event.preventDefault();
      }}
      onClick={(event) => {
        if (pointerStartedOutside.current && event.target === event.currentTarget && isOutsideDialog(event)) requestClose();
        pointerStartedOutside.current = false;
      }}
    >
      {children}
    </dialog>,
    document.body,
  );
}
