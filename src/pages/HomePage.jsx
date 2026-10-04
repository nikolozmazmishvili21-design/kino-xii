import { getComingSoonMovies, getFeaturedMovies, getNowPlayingMovies } from "../api/moviesApi.js";
import ComingSoonSection from "../components/home/ComingSoonSection.jsx";
import HeroCarousel from "../components/home/HeroCarousel.jsx";
import NowPlayingSection from "../components/home/NowPlayingSection.jsx";
import useCatalogueSection from "../components/home/useCatalogueSection.js";

// Home 139:2899 contains six big cards and four medium cards, including overflow.
const loadNowPlaying = (options) => getNowPlayingMovies({ ...options, limit: 6 });
const loadComingSoon = (options) => getComingSoonMovies({ ...options, limit: 4 });

export default function HomePage() {
  const featured = useCatalogueSection(getFeaturedMovies);
  const nowPlaying = useCatalogueSection(loadNowPlaying);
  const comingSoon = useCatalogueSection(loadComingSoon);

  return (
    <>
      <main className="home-page">
        <h1 className="visually-hidden">Kino XII movie catalogue</h1>
        <HeroCarousel state={featured} />
        <div className="home-page__catalogue">
          <NowPlayingSection state={nowPlaying} />
          <div className="home-page__divider" aria-hidden="true" />
          <ComingSoonSection state={comingSoon} />
        </div>
      </main>
      <footer className="home-footer">
        <div className="home-footer__content">
          <span className="home-footer__logo">KINO <span>XII</span></span>
          <p>© 2026 Kino XII. All rights reserved.</p>
        </div>
      </footer>
    </>
  );
}
