import paginationArrow from "../../assets/icons/sessions-pagination-arrow.svg";
import { sessionPageNumbers } from "../../sessions/sessionsPresentation.js";

export default function SessionsPagination({ currentPage, lastPage, onChange }) {
  const pages = sessionPageNumbers(currentPage, lastPage);
  if (!pages.length) return null;
  return (
    <nav className="sessions-pagination" aria-label="Sessions pages">
      <button type="button" className="sessions-pagination__arrow" aria-label="Previous page"
        disabled={currentPage === 1} onClick={() => onChange(currentPage - 1)}>
        <img src={paginationArrow} alt="" />
      </button>
      {pages.map((page) => typeof page === "number" ? (
        <button key={page} type="button" aria-label={`Page ${page}`}
          aria-current={page === currentPage ? "page" : undefined} onClick={() => onChange(page)}>
          {page}
        </button>
      ) : <span key={page} className="sessions-pagination__ellipsis" aria-hidden="true">…</span>)}
      <button type="button" className="sessions-pagination__arrow sessions-pagination__arrow--next"
        aria-label="Next page" disabled={currentPage === lastPage} onClick={() => onChange(currentPage + 1)}>
        <img src={paginationArrow} alt="" />
      </button>
    </nav>
  );
}
