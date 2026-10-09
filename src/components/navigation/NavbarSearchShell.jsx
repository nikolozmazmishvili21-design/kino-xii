import { useCallback, useId, useRef, useState } from "react";
import searchIcon from "../../assets/icons/search.svg";
import SearchOverlay from "./SearchOverlay.jsx";

export default function NavbarSearchShell() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null), id = useId();
  const close = useCallback(() => setOpen(false), []);
  return (
    <div className="navbar-search">
      <button ref={triggerRef} type="button" className="navbar-search__pill" aria-label="Search films and live events"
        aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(current => !current)}>
        <img src={searchIcon} alt="" />
        <span>Search films and live events</span>
      </button>
      {open && <SearchOverlay id={id} openerRef={triggerRef} onClose={close} />}
    </div>
  );
}
