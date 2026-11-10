import { FrontPage } from "@/components/front-page";
import { listSiteVideos } from "@/lib/site-video-data";

/**
 * The front page as a visitor gets it, served whole.
 *
 * The proxy (supabase/proxy.ts) sends a signed-out request for `/` here, and
 * the address stays `/`. The home page proper is drawn per request, because
 * for somebody signed in it is their dashboard, and every page drawn that way
 * waits behind the app's loading skeleton. This page waits on nothing, so it
 * arrives complete in the first response.
 *
 * It used to be built ahead of time. It is drawn per request now so its
 * scripts carry that request's Content-Security-Policy nonce (src/proxy.ts);
 * a page built ahead has no request to take one from, and its scripts would be
 * blocked.
 */

export default function WelcomePage() {
  return <FrontPage videos={listSiteVideos()} />;
}
