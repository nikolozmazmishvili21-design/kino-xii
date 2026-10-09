import { useLayoutEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { movieDetailPath, ROUTES } from "../../routing/routes.js";
import useMovieSearch from "../../search/useMovieSearch.js";
import { searchMovieMetadata, searchMoviePrice, searchTitleParts } from "../../search/searchPresentation.js";
import MovieImage from "../home/MovieImage.jsx";
import searchIcon from "../../assets/icons/search.svg";
import popcornIcon from "../../assets/icons/search-popcorn.svg";
import emptyIcon from "../../assets/icons/search-empty.svg";

export default function SearchOverlay({ id, openerRef, onClose }) {
  const overlayRef = useRef(null), inputRef = useRef(null), restoreFocusRef = useRef(true);
  const activeRef = useRef(false);
  const search = useMovieSearch(), { cancel } = search;
  useLayoutEffect(() => {
    const overlay = overlayRef.current, opener = openerRef.current;
    activeRef.current = true;
    restoreFocusRef.current = true;
    function position() {
      const anchor = opener.getBoundingClientRect(), width = Math.min(480, window.innerWidth - 32);
      overlay.style.setProperty("--search-left", `${Math.max(16, Math.min(anchor.right - width, window.innerWidth - width - 16))}px`);
      overlay.style.setProperty("--search-top", `${Math.max(16, Math.min(anchor.top, window.innerHeight - 100))}px`);
    }
    const beforeToggle = event => { if (event.newState === "closed") cancel(); };
    const toggle = event => { if (event.newState === "closed" && !overlay.matches(":popover-open")) onClose(); };
    overlay.addEventListener("beforetoggle", beforeToggle);
    overlay.addEventListener("toggle", toggle);
    overlay.showPopover();
    position();
    inputRef.current.focus();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      activeRef.current = false; // Cleanup focus changes must not close a StrictMode remount.
      cancel();
      overlay.removeEventListener("beforetoggle", beforeToggle);
      overlay.removeEventListener("toggle", toggle);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      if (overlay.matches(":popover-open")) overlay.hidePopover();
      // Preserve a new outside/modal focus target. Escape/removal may leave body.
      if (restoreFocusRef.current && (overlay.contains(document.activeElement) || document.activeElement === document.body)
        && opener.isConnected && !document.querySelector("dialog[open]")) opener.focus();
    };
  }, [openerRef, onClose, cancel]);

  function close() { cancel(); onClose(); }
  function keyboard(event) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const links = [...overlayRef.current.querySelectorAll(".search-result")], index = links.indexOf(document.activeElement);
    if (!links.length || (index < 0 && document.activeElement !== inputRef.current)
      || (index < 0 && ["Home", "End"].includes(event.key))) return;
    event.preventDefault();
    const next = event.key === "Home" ? links[0] : event.key === "End" ? links.at(-1)
      : event.key === "ArrowDown" ? links[Math.min(index + 1, links.length - 1)]
        : index <= 0 ? (index === 0 ? inputRef.current : links.at(-1)) : links[index - 1];
    next.focus();
  }
  const prompt = search.status === "prompt", empty = search.status === "empty";
  const waiting = ["debouncing", "loading"].includes(search.status);
  return <section ref={overlayRef} id={id} popover="auto" className="search-overlay" role="dialog" aria-label="Search films and live events"
    onKeyDown={keyboard} onBlur={event => {
      if (activeRef.current && event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) {
        restoreFocusRef.current = false; // Blur precedes focus arriving at the next control.
        close();
      }
    }}>
    <form role="search" className={`search-input${search.query ? " search-input--filled" : ""}`} onSubmit={event => event.preventDefault()}>
      {search.query && <img src={searchIcon} alt="" />}
      <label htmlFor={id + "-input"} className="visually-hidden">Search by title</label>
      <input ref={inputRef} id={id + "-input"} type="search" value={search.query} placeholder="Search films and live events"
        autoComplete="off" aria-controls={id + "-results"} onChange={event => search.changeQuery(event.target.value)} />
      {search.query && <button type="button" className="search-input__clear" aria-label="Clear search" onClick={() => {
        search.changeQuery(""); inputRef.current.focus();
      }}><span /><span /></button>}
    </form>
    <div className="search-panel" id={id + "-results"} aria-busy={waiting}>
      {(prompt || empty) && <div className="search-state">
        <div className="search-state__icon"><img src={prompt ? popcornIcon : emptyIcon} alt="" /></div>
        <p className="search-state__title" role={empty ? "status" : undefined}>{prompt ? "What do you want to watch?" : `No results for “${search.query}”`}</p>
        <p className="search-state__description">{prompt ? "Search by title" : "Check the spelling or try another film or live event."}</p>
        <Link to={ROUTES.sessions} className="button search-state__browse" onClick={close}>Browse all sessions</Link>
      </div>}
      {waiting && <div className="search-state"><p role="status">{search.status === "loading" ? "Searching titles…" : "Waiting for you to finish typing…"}</p></div>}
      {search.status === "error" && <div className="search-state"><p role="alert">{search.error}</p>
        <button type="button" className="button search-state__browse" onClick={() => { inputRef.current.focus(); search.retry(); }}>Retry search</button>
      </div>}
      {search.status === "results" && <>
        <div className="search-panel__header"><span>Films &amp; events</span><span role="status">{search.movies.length} {search.movies.length === 1 ? "result" : "results"}</span></div>
        <ul className="search-results">{search.movies.map((movie, index) => {
          const title = searchTitleParts(movie.title, search.query), metadata = searchMovieMetadata(movie), price = searchMoviePrice(movie);
          const poster = typeof movie.posterUrl === "string" && movie.posterUrl.trim() ? movie.posterUrl : null;
          return <li key={movie.slug + index}><Link className="search-result" to={movieDetailPath(movie.slug)} onClick={close}>
            <MovieImage src={poster} title={movie.title} />
            <span className="search-result__text"><span className="search-result__title" title={movie.title}>{title.before}<strong>{title.match}</strong>{title.after}</span>
              {metadata && <span className="search-result__metadata">{metadata}</span>}</span>
            {price && <span className={`search-result__price${movie.isComingSoon === true ? " search-result__price--soon" : ""}`}>{price}</span>}
          </Link></li>;
        })}</ul>
      </>}
    </div>
  </section>;
}
