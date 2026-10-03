import searchIcon from "../../assets/icons/search.svg";

// Visual slot only. The Search feature will own input, requests and results.
export default function NavbarSearchShell() {
  return (
    <div className="navbar-search">
      <button type="button" className="navbar-search__pill" disabled aria-label="Search films and live events (not available yet)">
        <img src={searchIcon} alt="" />
        <span>Search films and live events</span>
      </button>
    </div>
  );
}
