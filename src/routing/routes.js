export const ROUTES = {
  home: "/",
  sessions: "/sessions",
  movieDetail: "/movies/:slug",
  profile: "/profile",
};

export function movieDetailPath(slug) {
  return ROUTES.movieDetail.replace(":slug", encodeURIComponent(slug));
}

export function profileTicketsPath() {
  return `${ROUTES.profile}?tab=tickets`;
}

export function profileTab(search) {
  return new URLSearchParams(search).get("tab") === "tickets" ? "tickets" : "information";
}

// Missing/invalid filter values safely select Upcoming without rewriting history.
// This controls presentation only: My Tickets still reads the unfiltered list.
export function ticketsGroup(search) {
  return new URLSearchParams(search).get("filter") === "past" ? "past" : "upcoming";
}

export function ticketsGroupSearch(search, group) {
  if (!["upcoming", "past"].includes(group)) throw new TypeError("Tickets group must be upcoming or past.");
  const params = new URLSearchParams(search);
  params.set("tab", "tickets");
  params.set("filter", group);
  return params;
}
