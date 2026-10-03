import { BrowserRouter, Route, Routes } from "react-router-dom";
import HomePage from "../pages/HomePage.jsx";
import SessionsPage from "../pages/SessionsPage.jsx";
import MovieDetailPage from "../pages/MovieDetailPage.jsx";
import ProfilePage from "../pages/ProfilePage.jsx";
import NotFoundPage from "../pages/NotFoundPage.jsx";
import { ROUTES } from "./routes.js";
import AppShell from "../app/AppShell.jsx";

export default function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path={ROUTES.home} element={<HomePage />} />
          <Route path={ROUTES.sessions} element={<SessionsPage />} />
          <Route path={ROUTES.movieDetail} element={<MovieDetailPage />} />
          <Route path={ROUTES.profile} element={<ProfilePage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
