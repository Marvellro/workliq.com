"use client";

export default function About() {
  const values = [
    { icon: "⚡", title: "Automation should be effortless", desc: "We believe any business — regardless of technical ability — should be able to automate their most painful workflows in minutes, not months." },
    { icon: "🔍", title: "Transparency by default", desc: "Every automation run is logged, auditable, and reversible. We build trust by showing you exactly what our AI agents are doing on your behalf." },
    { icon: "🤝", title: "Built for operators", desc: "We design for the VP of Ops, the RevOps lead, the Chief of Staff — the people who actually run businesses and don't have time for tools that need babysitting." },
    { icon: "🌍", title: "Your data stays yours", desc: "We never use your data to train our models. Your workflows, your customers, and your processes belong to you — full stop." },
  ];

  const milestones = [
    { date: "Jan 2026", event: "Workliq founded" },
    { date: "Feb 2026", event: "First prototype built" },
    { date: "Mar 2026", event: "First paying customer" },
    { date: "Apr 2026", event: "214 integrations live" },
    { date: "May 2026", event: "White-label programme launched" },
    { date: "Jun 2026", event: "workliq.com goes live" },
  ];

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", fontFamily: "system-ui, -apple-system, sans-serif", padding: "0 1.5rem" }}>

      {/* NAV */}
      <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1.2rem 0 0" }}>
        <a href="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
          <div style={{ width: 28, height: 28, background: "#1A56DB", borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 500, color: "#fff" }}>W</div>
          <span style={{ fontSize: 15, fontWeight: 500, color: "#0D0F1A", letterSpacing: "-0.02em" }}>Workliq</span>
        </a>
        <a href="/" style={{ fontSize: 13, color: "#6B7280", textDecoration: "none" }}>← Back to home</a>
      </nav>

      {/* HERO */}
      <div style={{ padding: "3.5rem 0 2.5rem", borderBottom: "0.5px solid #E5E7EB", marginBottom: "2.5rem" }}>
        <div style={{ fontSize: 11, fontFamily: "monospace", color: "#1A56DB", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 14 }}>About Workliq</div>
        <h1 style={{ fontSize: "clamp(28px, 5vw, 40px)", fontWeight: 500, color: "#0D0F1A", letterSpacing: "-0.025em", lineHeight: 1.1, marginBottom: 16 }}>
          We&apos;re making AI automation<br />
          <span style={{ color: "#1A56DB", fontStyle: "italic" }}>flow through every business.</span>
        </h1>
        <p style={{ fontSize: 16, color: "#6B7280", lineHeight: 1.7, maxWidth: 560 }}>
          Workliq is building the infrastructure layer for AI workflow automation — a platform that lets any operations team replace manual, repetitive work with intelligent agents that run 24/7, no engineers required.
        </p>
      </div>

      {/* MISSION */}
      <div style={{ marginBottom: "3rem" }}>
        <div style={{ fontSize: 11, fontWeight: 500, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 14 }}>Our mission</div>
        <div style={{ background: "#F0F6FF", border: "0.5px solid #BFDBFE", borderLeft: "4px solid #1A56DB", borderRadius: 10, padding: "20px 24px" }}>
          <p style={{ fontSize: 18, fontWeight: 500, color: "#0D0F1A", lineHeight: 1.5, margin: 0 }}>
            "To make AI automation as easy to use as sending an email — so that every business can reclaim the hours lost to manual, repetitive work."
          </p>
        </div>
      </div>

      {/* STORY */}
      <div style={{ marginBottom: "3rem" }}>
        <div style={{ fontSize: 11, fontWeight: 500, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 14 }}>The story</div>
        <div style={{ fontSize: 15, color: "#374151", lineHeight: 1.85 }}>
          <p style={{ marginBottom: 16 }}>
            Workliq started from a simple observation: every ops team we talked to was spending 10–20 hours a week doing the same things — updating CRM records, routing support tickets, generating reports, syncing data between tools. Work that felt important in the moment but added zero real value.
          </p>
          <p style={{ marginBottom: 16 }}>
            The tools that existed were either too simple (Zapier breaks the moment anything gets complex) or too expensive to build (a custom automation platform costs $300k+ and takes 12–18 months). There was nothing in the middle — nothing that gave a 500-person SaaS company the same automation capabilities as a company with a 10-person engineering team.
          </p>
          <p style={{ marginBottom: 16 }}>
            So we built Workliq. A full AI automation platform — workflow builder, AI agents, 214 integrations, white-label reseller programme, public API — designed to be deployed in days, not months, and operated by anyone, not just engineers.
          </p>
          <p>
            We launched in 2026, found our first customer immediately, and have been building in public ever since. We&apos;re based in Stockholm and building for the world.
          </p>
        </div>
      </div>

      {/* VALUES */}
      <div style={{ marginBottom: "3rem" }}>
        <div style={{ fontSize: 11, fontWeight: 500, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 14 }}>What we believe</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {values.map((v, i) => (
            <div key={i} style={{ background: "#fff", border: "0.5px solid #E5E7EB", borderRadius: 12, padding: "14px 16px" }}>
              <div style={{ fontSize: 22, marginBottom: 8 }}>{v.icon}</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: "#0D0F1A", marginBottom: 6 }}>{v.title}</div>
              <div style={{ fontSize: 12, color: "#6B7280", lineHeight: 1.55 }}>{v.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* MILESTONES */}
      <div style={{ marginBottom: "3rem" }}>
        <div style={{ fontSize: 11, fontWeight: 500, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 14 }}>Timeline</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {milestones.map((m, i) => (
            <div key={i} style={{ display: "flex", gap: 16, paddingBottom: 14, position: "relative" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 16 }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#1A56DB", flexShrink: 0, marginTop: 3 }} />
                {i < milestones.length - 1 && (
                  <div style={{ width: 1, flex: 1, background: "#E5E7EB", marginTop: 4 }} />
                )}
              </div>
              <div style={{ paddingBottom: 4 }}>
                <div style={{ fontSize: 11, fontFamily: "monospace", color: "#1A56DB", marginBottom: 2 }}>{m.date}</div>
                <div style={{ fontSize: 14, color: "#374151", fontWeight: 500 }}>{m.event}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* TEAM */}
      <div style={{ marginBottom: "3rem" }}>
        <div style={{ fontSize: 11, fontWeight: 500, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 14 }}>Founding team</div>
        <div style={{ background: "#F9FAFB", border: "0.5px solid #E5E7EB", borderRadius: 12, padding: "20px" }}>

          {/* REPLACE THIS SECTION with your real name, photo, bio, and LinkedIn */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 20 }}>
            <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#1A56DB", display: "flex", alignItems: "center", justifyContent: "center",fontSize: 14, fontWeight: 500, color: "#fff", flexShrink: 0 }}>
              Y
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 500, color: "#0D0F1A", marginBottom: 2 }}>Marvellous Junior Okorie</div>
              <div style={{ fontSize: 12, color: "#1A56DB", marginBottom: 8 }}>Founder & CEO</div>
              <div style={{ fontSize: 13, color: "#6B7280", lineHeight: 1.6, marginBottom: 8 }}>
                Marvellous spent years in sales and marketing watching operations teams lose hours every week to manual, repetitive work — updating CRMs, routing tickets, chasing data across tools. Based in Stockholm, Sweden, he founded Workliq in 2026 to give every business the automation power that only well-funded engineering teams used to have. His background in sales means Workliq is built for the people who actually run businesses, not just the people who build software. — 2–3 sentences about your background, what you did before Workliq, and why you started the company. Investors and customers read this. Make it personal and specific.
              </div>
              <a href="https://linkedin.com/in/marvellous-junior-okorie" target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#1A56DB", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
                LinkedIn →
              </a>
            </div>
          </div>

          <div style={{ fontSize: 12, color: "#9CA3AF", fontStyle: "italic", borderTop: "0.5px solid #E5E7EB", paddingTop: 12 }}>
            We&apos;re a small, focused team building in Stockholm, Sweden. We&apos;re always open to meeting exceptional people — reach out at hello@workliq.com.
          </div>
        </div>
      </div>

      {/* STATS */}
      <div style={{ marginBottom: "3rem" }}>
        <div style={{ fontSize: 11, fontWeight: 500, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 14 }}>By the numbers</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 10 }}>
          {[
            ["214", "integrations"],
            ["48", "workflow templates"],
            ["14", "product surfaces built"],
            ["24", "customers"],
            ["47k+", "automation runs/mo"],
            ["4 days", "avg time to go live"],
          ].map(([v, l], i) => (
            <div key={i} style={{ background: "#fff", border: "0.5px solid #E5E7EB", borderRadius: 10, padding: "12px 14px", textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 500, color: "#0D0F1A", marginBottom: 3 }}>{v}</div>
              <div style={{ fontSize: 11, color: "#9CA3AF" }}>{l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div style={{ background: "#0D0F1A", borderRadius: 16, padding: "28px 32px", marginBottom: "3rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 500, color: "#F0F2EE", marginBottom: 6 }}>Want to work together?</div>
          <div style={{ fontSize: 13, color: "#6B7280", lineHeight: 1.5 }}>We&apos;re always open to conversations with customers, investors, and partners.</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a href="mailto:hello@workliq.com" style={{ fontSize: 13, padding: "9px 18px", borderRadius: 8, background: "#1A56DB", color: "#fff", textDecoration: "none", fontWeight: 500, whiteSpace: "nowrap" }}>
            Get in touch
          </a>
          <a href="/pricing" style={{ fontSize: 13, padding: "9px 18px", borderRadius: 8, background: "transparent", color: "#C8F135", border: "0.5px solid #C8F135", textDecoration: "none", fontWeight: 500, whiteSpace: "nowrap" }}>
            See pricing
          </a>
        </div>
      </div>

      {/* FOOTER */}
      <footer style={{ textAlign: "center", padding: "1.5rem 0", borderTop: "0.5px solid #E5E7EB", fontSize: 12, color: "#9CA3AF", fontFamily: "monospace" }}>
        © 2026 Workliq Inc. · Stockholm, Sweden ·{" "}
        <a href="/terms" style={{ color: "#9CA3AF" }}>Terms</a> ·{" "}
        <a href="/privacy" style={{ color: "#9CA3AF" }}>Privacy</a>
      </footer>
    </main>
  );
}
