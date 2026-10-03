import { useEffect, useId, useState } from "react";
import uploadIcon from "../../assets/icons/upload.svg";

export default function AvatarField() {
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
        aria-describedby={`${id}-hint`}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) setSelection({ name: file.name, url: URL.createObjectURL(file) });
        }}
      />
      <span className="visually-hidden" role="status">{selection ? `Selected avatar: ${selection.name}` : ""}</span>
    </div>
  );
}
