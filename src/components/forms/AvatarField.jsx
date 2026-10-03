import { useEffect, useId, useState } from "react";
import uploadIcon from "../../assets/icons/upload.svg";
import { validateAvatar } from "../../validation/authValidation.js";

export default function AvatarField({ value, onChange, error, disabled = false }) {
  const id = useId();
  const [selection, setSelection] = useState(null);

  useEffect(() => {
    if (!selection) return;
    return () => URL.revokeObjectURL(selection.url);
  }, [selection]);

  return (
    <div className="avatar-field">
      <label className="avatar-field__label" htmlFor={id}>
        <span className="avatar-field__preview">
          {selection ? <img className="avatar-field__image" src={selection.url} alt="" /> : <img src={uploadIcon} alt="" />}
        </span>
        <span className="avatar-field__copy">
          <span className="avatar-field__title">Upload avatar (optional)</span>
          <span className="avatar-field__hint" id={`${id}-hint`}>JPG, PNG or WEBP</span>
        </span>
      </label>
      <input
        id={id}
        className="visually-hidden avatar-field__input"
        type="file"
        name="avatar"
        accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={[`${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ")}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (!file) return;
          const selectionError = validateAvatar(file);
          onChange(selectionError ? null : file, selectionError);
          setSelection(selectionError ? null : { name: file.name, url: URL.createObjectURL(file) });
          // Allow selecting the same file again after server rejection.
          event.currentTarget.value = "";
        }}
      />
      {error && <p className="form-field__error avatar-field__error" id={`${id}-error`} role="alert">{(Array.isArray(error) ? error : [error]).map((message, index) => <span className="form-field__error-message" key={index}>{message}</span>)}</p>}
      <span className="visually-hidden" role="status">{selection && value ? `Selected avatar: ${selection.name}` : ""}</span>
    </div>
  );
}
