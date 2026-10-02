import { FrontPage } from "@/components/front-page";
import { listSiteVideos } from "@/lib/site-video-data";

/**
 * The front page as a visitor gets it: built ahead of time and served whole.
 *
 * The proxy (supabase/proxy.ts) sends a signed-out request for `/` here, and
 * the address stays `/`. The home page proper is drawn per request, because
 * for somebody signed in it is their dashboard, and every page drawn that way
 * waits behind the app's loading skeleton. A stranger's first sight of
 * Volteira was often that skeleton — a dashboard with a sidebar — for a moment
 * before the front page replaced it. Built ahead, the page arrives complete.
 *
 * Signed out is the same for everybody, so nothing here depends on who asked.
 */
export const dynamic = "force-static";

// Rebuilt five minutes after a visit at most, and straight away when support
// changes the videos (admin/front-page/actions.ts).
export const revalidate = 300;

export default function WelcomePage() {
  return <FrontPage videos={listSiteVideos()} />;
}
