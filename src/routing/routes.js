export const ROUTES = {
  home: "/",
  sessions: "/sessions",
  movieDetail: "/movies/:slug",
  profile: "/profile",
};

export function movieDetailPath(slug) {
  return ROUTES.movieDetail.replace(":slug", encodeURIComponent(slug));
}
