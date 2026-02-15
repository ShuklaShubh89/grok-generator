/**
 * Vercel serverless function: fetches an image from imgen.x.ai and returns it.
 * Used so the browser never hits imgen.x.ai directly (avoids CORS).
 * Only allows URLs from https://imgen.x.ai/
 */
const ALLOWED_ORIGIN = "https://imgen.x.ai";

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url).searchParams.get("url");
    if (!url || !url.startsWith(ALLOWED_ORIGIN + "/")) {
      return new Response("Bad request", { status: 400 });
    }
    try {
      const res = await fetch(url);
      if (!res.ok) return new Response("Upstream error", { status: res.status });
      const contentType = res.headers.get("content-type") ?? "image/jpeg";
      const body = await res.arrayBuffer();
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": contentType },
      });
    } catch {
      return new Response("Proxy error", { status: 502 });
    }
  },
};
