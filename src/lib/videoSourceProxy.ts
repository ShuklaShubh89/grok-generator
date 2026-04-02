export function buildVideoSourceProxyUrl(key: string): string {
  const configuredBaseUrl = import.meta.env.VITE_PUBLIC_APP_URL?.trim();
  const baseUrl = configuredBaseUrl || window.location.origin;

  if (!configuredBaseUrl && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(baseUrl)) {
    throw new Error(
      "Private S3 video uploads need a public app URL so xAI can fetch the proxy endpoint. Set VITE_PUBLIC_APP_URL to your deployed domain or tunnel URL."
    );
  }

  return new URL(`/api/video-source?key=${encodeURIComponent(key)}`, baseUrl).toString();
}
