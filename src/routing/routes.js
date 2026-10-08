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
