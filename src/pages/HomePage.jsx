import { useCallback } from "react";
import { getFeaturedMovies, getNowPlayingMovies } from "../api/moviesApi.js";
import { useAuth } from "../auth/AuthContext.js";
import { useNotifications } from "../notifications/NotificationContext.js";
import ComingSoonSection from "../components/home/ComingSoonSection.jsx";
import HeroCarousel from "../components/home/HeroCarousel.jsx";
import NowPlayingSection from "../components/home/NowPlayingSection.jsx";
import RecentlyViewedSection from "../components/home/RecentlyViewedSection.jsx";
import useCatalogueSection from "../components/home/useCatalogueSection.js";
import Footer from "../components/Footer.jsx";

// Home 139:2899 contains six big cards and four medium cards, including overflow.
const loadNowPlaying = (options) => getNowPlayingMovies({ ...options, limit: 6 });

export default function HomePage() {
  const notifications = useNotifications();
  const { status, user, mutation } = useAuth();
  const loadComingSoon = useCallback((options) => notifications.loadCatalogue({ ...options, limit: 4 }),
    // Reload optional account-specific indicators after authentication changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [notifications, status, user, mutation]);
  const featured = useCatalogueSection(getFeaturedMovies);
  const nowPlaying = useCatalogueSection(loadNowPlaying);
  const comingSoon = useCatalogueSection(loadComingSoon);
  const historyOwner = status === "authenticated" ? user?.id : status === "guest" ? null : undefined;

  return (
    <>
      <main className="home-page">
        <h1 className="visually-hidden">Kino XII movie catalogue</h1>
        <HeroCarousel state={featured} />
        <div className="home-page__catalogue">
          {!mutation && historyOwner !== undefined && <RecentlyViewedSection key={historyOwner ?? "guest"} userId={historyOwner} />}
          <NowPlayingSection state={nowPlaying} />
          <div className="home-page__divider" aria-hidden="true" />
          <ComingSoonSection state={comingSoon} />
        </div>
      </main>
      <Footer />
    </>
  );
}
