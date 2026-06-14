import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { posts, getPost } from "../data";

// ── Static generation ─────────────────────────────────────────────────────────
export function generateStaticParams() {
  return posts.map((p) => ({ slug: p.slug }));
}

// ── SEO metadata ──────────────────────────────────────────────────────────────
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return {};
  return {
    title: `${post.title} — Workliq Blog`,
    description: post.excerpt,
    openGraph: {
      title: post.title,
      description: post.excerpt,
      type: "article",
      publishedTime: post.dateIso,
      siteName: "Workliq",
    },
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default async function BlogPost({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  return (
    <main style={{ maxWidth: 680, margin: "0 auto", fontFamily: "system-ui, -apple-system, sans-serif", padding: "0 1.5rem" }}>

      {/* NAV */}
      <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1.2rem 0 0", flexWrap: "wrap", gap: 10 }}>
        <a href="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
          <div style={{ width: 28, height: 28, background: "#1A56DB", borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 600, color: "#fff" }}>W</div>
          <span style={{ fontSize: 15, fontWeight: 600, color: "#0D0F1A", letterSpacing: "-0.025em" }}>Workliq</span>
        </a>
        <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
          <a href="/blog" style={{ fontSize: 13, color: "#6B7280", textDecoration: "none" }}>← All articles</a>
          <a href="/pricing" style={{ fontSize: 13, color: "#6B7280", textDecoration: "none" }}>Pricing</a>
        </div>
      </nav>

      {/* POST HEADER */}
      <header style={{ padding: "3rem 0 2rem", borderBottom: "0.5px solid #E5E7EB", marginBottom: "2.25rem" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: post.categoryColor, background: `${post.categoryColor}14`, border: `0.5px solid ${post.categoryColor}40`, padding: "3px 9px", borderRadius: 20 }}>
            {post.category}
          </span>
          <span style={{ fontSize: 11, color: "#9CA3AF" }}>{post.date}</span>
          <span style={{ fontSize: 11, color: "#D1D5DB" }}>·</span>
          <span style={{ fontSize: 11, color: "#9CA3AF" }}>{post.readTime}</span>
        </div>

        <h1 style={{ fontSize: "clamp(24px, 5vw, 36px)", fontWeight: 600, color: "#0D0F1A", letterSpacing: "-0.025em", lineHeight: 1.18, marginBottom: 16 }}>
          {post.title}
        </h1>

        <p style={{ fontSize: 16, color: "#6B7280", lineHeight: 1.7, margin: 0 }}>
          {post.excerpt}
        </p>
      </header>

      {/* POST BODY */}
      <div
        dangerouslySetInnerHTML={{ __html: post.content }}
        style={{
          fontSize: 15,
          lineHeight: 1.85,
          color: "#374151",
          marginBottom: "3rem",
        }}
      />

      {/* CTA BLOCK */}
      <div style={{ background: "#0D0F1A", borderRadius: 16, padding: "28px 28px", marginBottom: "2.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#F0F2EE", marginBottom: 6, letterSpacing: "-0.01em" }}>Ready to automate your workflows?</div>
          <div style={{ fontSize: 13, color: "#6B7280", lineHeight: 1.55 }}>Join 247+ teams using Workliq to replace manual ops.</div>
        </div>
        <a href="/" style={{ fontSize: 13, padding: "11px 20px", borderRadius: 9, background: "#1A56DB", color: "#fff", textDecoration: "none", fontWeight: 600, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", minHeight: 44 }}>
          Join the waitlist →
        </a>
      </div>

      {/* MORE POSTS */}
      <div style={{ marginBottom: "2.5rem" }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>More articles</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {posts
            .filter((p) => p.slug !== post.slug)
            .map((p) => (
              <a
                key={p.slug}
                href={`/blog/${p.slug}`}
                style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "12px", border: "0.5px solid #E5E7EB", borderRadius: 10, textDecoration: "none", background: "#fff" }}
              >
                <span style={{ fontSize: 11, fontWeight: 600, color: p.categoryColor, background: `${p.categoryColor}14`, border: `0.5px solid ${p.categoryColor}40`, padding: "2px 8px", borderRadius: 20, flexShrink: 0, whiteSpace: "nowrap" }}>
                  {p.category}
                </span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#0D0F1A", lineHeight: 1.4, marginBottom: 3, letterSpacing: "-0.01em" }}>{p.title}</div>
                  <div style={{ fontSize: 11, color: "#9CA3AF" }}>{p.readTime}</div>
                </div>
              </a>
            ))}
        </div>
      </div>

      {/* FOOTER */}
      <footer style={{ textAlign: "center", padding: "1.5rem 0 2rem", borderTop: "0.5px solid #E5E7EB", fontSize: 12, color: "#9CA3AF", fontFamily: "monospace" }}>
        © 2026 Workliq Inc. · Stockholm, Sweden ·{" "}
        <a href="/about" style={{ color: "#9CA3AF" }}>About</a> ·{" "}
        <a href="/pricing" style={{ color: "#9CA3AF" }}>Pricing</a> ·{" "}
        <a href="/terms" style={{ color: "#9CA3AF" }}>Terms</a> ·{" "}
        <a href="/privacy" style={{ color: "#9CA3AF" }}>Privacy</a>
      </footer>

      {/* Blog post body typography */}
      <style>{`
        [data-blog-content] p,
        main p + p { margin-top: 1.1rem; }

        main article h2 { display: none; }

        /* Prose styles applied to the dangerouslySetInnerHTML div */
        main > div > h2 {
          font-size: 1.15rem;
          font-weight: 700;
          color: #0D0F1A;
          letter-spacing: -0.02em;
          margin: 2rem 0 0.75rem;
          line-height: 1.3;
        }
        main > div > h3 {
          font-size: 1rem;
          font-weight: 700;
          color: #0D0F1A;
          letter-spacing: -0.01em;
          margin: 1.5rem 0 0.5rem;
        }
        main > div > p {
          margin: 0 0 1.1rem;
        }
        main > div > ul {
          margin: 0 0 1.1rem;
          padding-left: 1.4rem;
        }
        main > div > ul > li {
          margin-bottom: 0.4rem;
        }
        main > div > blockquote {
          border-left: 3px solid #1A56DB;
          margin: 1.5rem 0;
          padding: 0.75rem 1.25rem;
          background: #F0F6FF;
          border-radius: 0 8px 8px 0;
          font-style: italic;
          color: #374151;
        }
        main > div > p > strong {
          color: #0D0F1A;
          font-weight: 700;
        }
        main > div > p > em {
          color: #1A56DB;
          font-style: italic;
        }
        @media (max-width: 480px) {
          main > div { font-size: 14px !important; }
        }
      `}</style>
    </main>
  );
}
