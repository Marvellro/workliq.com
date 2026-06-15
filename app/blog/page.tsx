import type { Metadata } from "next";
import { posts } from "./data";

export const metadata: Metadata = {
  title: "Blog — Workliq",
  description: "Practical guides on AI workflow automation, RevOps efficiency, and replacing manual processes with intelligent agents.",
};

export default function BlogIndex() {
  return (
    <main style={{ maxWidth: 700, margin: "0 auto", fontFamily: "system-ui, -apple-system, sans-serif", padding: "0 1.5rem" }}>

      {/* NAV */}
      <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1.2rem 0 0", flexWrap: "wrap", gap: 10 }}>
        <a href="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
          <div style={{ width: 28, height: 28, background: "#1A56DB", borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 600, color: "#fff" }}>W</div>
          <span style={{ fontSize: 15, fontWeight: 600, color: "#0D0F1A", letterSpacing: "-0.025em" }}>Workliq</span>
        </a>
        <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
          <a href="/about" style={{ fontSize: 13, color: "#6B7280", textDecoration: "none" }}>About</a>
          <a href="/pricing" style={{ fontSize: 13, color: "#6B7280", textDecoration: "none" }}>Pricing</a>
          <a href="/" style={{ fontSize: 13, color: "#6B7280", textDecoration: "none" }}>← Home</a>
        </div>
      </nav>

      {/* HEADER */}
      <div style={{ padding: "3rem 0 2rem", borderBottom: "0.5px solid #E5E7EB", marginBottom: "2.5rem" }}>
        <div style={{ fontSize: 11, fontFamily: "monospace", color: "#1A56DB", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12, fontWeight: 600 }}>The Workliq Blog</div>
        <h1 style={{ fontSize: "clamp(26px, 5vw, 38px)", fontWeight: 500, color: "#0D0F1A", letterSpacing: "-0.025em", lineHeight: 1.15, marginBottom: 12 }}>
          Practical guides on<br />AI workflow automation
        </h1>
        <p style={{ fontSize: 15, color: "#6B7280", lineHeight: 1.65, maxWidth: 480, margin: 0 }}>
          No fluff. Just concrete advice on replacing manual ops work with AI that runs 24/7.
        </p>
      </div>

      {/* POST LIST */}
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {posts.map((post, i) => (
          <article
            key={post.slug}
            style={{ paddingBottom: "2rem", marginBottom: "2rem", borderBottom: i < posts.length - 1 ? "0.5px solid #F0F1F3" : "none" }}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: post.categoryColor, background: `${post.categoryColor}14`, border: `0.5px solid ${post.categoryColor}40`, padding: "3px 9px", borderRadius: 20 }}>
                {post.category}
              </span>
              <span style={{ fontSize: 11, color: "#9CA3AF" }}>{post.date}</span>
              <span style={{ fontSize: 11, color: "#D1D5DB" }}>·</span>
              <span style={{ fontSize: 11, color: "#9CA3AF" }}>{post.readTime}</span>
            </div>

            <h2 style={{ margin: "0 0 10px" }}>
              <a
                href={`/blog/${post.slug}`}
                style={{ fontSize: "clamp(17px, 3vw, 21px)", fontWeight: 600, color: "#0D0F1A", textDecoration: "none", letterSpacing: "-0.02em", lineHeight: 1.3 }}
              >
                {post.title}
              </a>
            </h2>

            <p style={{ fontSize: 14, color: "#6B7280", lineHeight: 1.7, margin: "0 0 14px", maxWidth: 560 }}>
              {post.excerpt}
            </p>

            <a
              href={`/blog/${post.slug}`}
              style={{ fontSize: 13, color: "#1A56DB", textDecoration: "none", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              Read article →
            </a>
          </article>
        ))}
      </div>

      {/* CTA */}
      <div style={{ background: "#F9FAFB", border: "0.5px solid #E5E7EB", borderRadius: 14, padding: "24px", marginBottom: "2.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#0D0F1A", marginBottom: 4, letterSpacing: "-0.01em" }}>Ready to automate your ops?</div>
          <div style={{ fontSize: 13, color: "#6B7280", lineHeight: 1.5 }}>Join 247+ teams using Workliq to eliminate manual work.</div>
        </div>
        <a href="/" style={{ fontSize: 13, padding: "10px 18px", borderRadius: 9, background: "#1A56DB", color: "#fff", textDecoration: "none", fontWeight: 600, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", minHeight: 44 }}>
          Join the waitlist →
        </a>
      </div>

      {/* FOOTER */}
      <footer style={{ textAlign: "center", padding: "1.5rem 0 2rem", borderTop: "0.5px solid #E5E7EB", fontSize: 12, color: "#9CA3AF", fontFamily: "monospace" }}>
        © 2026 Workliq Inc. · Stockholm, Sweden ·{" "}
        <a href="/about" style={{ color: "#9CA3AF" }}>About</a> ·{" "}
        <a href="/pricing" style={{ color: "#9CA3AF" }}>Pricing</a> ·{" "}
        <a href="/terms" style={{ color: "#9CA3AF" }}>Terms</a> ·{" "}
        <a href="/privacy" style={{ color: "#9CA3AF" }}>Privacy</a>
      </footer>
    </main>
  );
}
