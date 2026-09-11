import type { NextConfig } from "next";

// Security headers applied to every response.
//
// These are cheap and prevent whole categories of attack that are otherwise
// entirely dependent on a customer's browser behaving well.
const securityHeaders = [
  // Stops the browser from guessing a response is a different content type than
  // declared — the mechanism behind "upload a .txt, get it executed as JS".
  { key: "X-Content-Type-Options", value: "nosniff" },

  // No framing at all. Workliq has no embed use case, and framing enables
  // clickjacking: overlaying an invisible dashboard so a customer's click lands
  // on "disconnect HubSpot" or "delete workflow".
  { key: "X-Frame-Options", value: "DENY" },

  // Send the full URL only to ourselves. Dashboard URLs can carry connection
  // state in query params, and those must not leak to third parties via Referer.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

  // Nothing here needs these APIs; denying them limits what injected script
  // could reach for.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },

  // Force HTTPS for two years including subdomains. `preload` is intentionally
  // omitted: submission to the browser preload list is effectively irreversible
  // and would break any future plain-HTTP subdomain.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];

// Content-Security-Policy is separate because it needs per-directive comment.
//
// 'unsafe-inline' on script-src is required by Next's App Router: it inlines
// bootstrap and streaming-hydration scripts. Removing it needs nonce-based CSP,
// which in turn requires all pages to be dynamically rendered — that would cost
// the static rendering of the marketing pages. Revisit if/when Next ships nonce
// support that doesn't force dynamic rendering.
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  // Supabase (auth + data) and Stripe checkout are the only cross-origin calls
  // the browser makes. Anything else is a bug or an injection.
  "connect-src 'self' https://*.supabase.co https://api.stripe.com",
  "frame-src https://js.stripe.com https://hooks.stripe.com",
  "object-src 'none'",
  "base-uri 'self'",
  // Stops an injected <form> from posting session-bearing requests off-site.
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  // Never leak the framework version in response headers.
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          ...securityHeaders,
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
        ],
      },
    ];
  },
};

export default nextConfig;
