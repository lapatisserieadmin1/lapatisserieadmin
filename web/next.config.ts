import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The public La Patisserie website is the static site in public/site; its order form and product
  // list talk to /api/site/*. Staff sign in at /login.
  async rewrites() {
    return [{ source: "/", destination: "/site/index.html" }];
  },
  // The quotation PDF and PNG read their fonts from disk at run time: made in the route, and in the order
  // actions that send them on WhatsApp Business.
  outputFileTracingIncludes: {
    "/api/orders/\\[id\\]/quotation": ["./assets/fonts/*.woff", "./public/brand/wordmark.png"],
    "/api/terms": ["./assets/fonts/*.woff", "./public/brand/wordmark.png"],
    "/api/todo": ["./assets/fonts/*.woff", "./public/brand/wordmark.png"],
    "/terms/\\[ref\\]": ["./assets/fonts/*.woff", "./public/brand/wordmark.png"],
    "/admin/**": ["./assets/fonts/*.woff", "./public/brand/wordmark.png"],
  },
  // Let browsers and Vercel's CDN keep the website's files instead of asking again on every visit.
  async headers() {
    return [
      {
        source: "/site/images/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
      },
      {
        source: "/site/:file(style.css|script.js)",
        headers: [{ key: "Cache-Control", value: "public, max-age=600, stale-while-revalidate=86400" }],
      },
    ];
  },
};

export default nextConfig;
