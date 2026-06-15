"use client";

import { useState } from "react";

// ─── SVG Brand Logos ──────────────────────────────────────────────────────────
function SlackLogo() {
  return (
    <svg width="72" height="20" viewBox="0 0 72 20" fill="none" aria-label="Slack">
      {/* 4-color hashtag cross */}
      <rect x="0" y="7.5" width="5" height="5" rx="2.5" fill="#E01E5A"/>
      <rect x="7.5" y="7.5" width="5" height="5" rx="2.5" fill="#ECB22E"/>
      <rect x="7.5" y="0" width="5" height="5" rx="2.5" fill="#36C5F0"/>
      <rect x="7.5" y="15" width="5" height="5" rx="2.5" fill="#E01E5A"/>
      <rect x="15" y="7.5" width="5" height="5" rx="2.5" fill="#2EB67D"/>
      <text x="24" y="15" fontFamily="system-ui,-apple-system,sans-serif" fontSize="13" fontWeight="700" fill="#4A154B">Slack</text>
    </svg>
  );
}

function HubSpotLogo() {
  return (
    <svg width="88" height="20" viewBox="0 0 88 20" fill="none" aria-label="HubSpot">
      <circle cx="10" cy="10" r="4" fill="#FF7A59"/>
      <rect x="9" y="2" width="2" height="5" rx="1" fill="#FF7A59"/>
      <rect x="9" y="13" width="2" height="5" rx="1" fill="#FF7A59"/>
      <rect x="2" y="9" width="5" height="2" rx="1" fill="#FF7A59"/>
      <rect x="13" y="9" width="5" height="2" rx="1" fill="#FF7A59"/>
      <text x="22" y="15" fontFamily="system-ui,-apple-system,sans-serif" fontSize="13" fontWeight="700" fill="#2D3748">HubSpot</text>
    </svg>
  );
}

function NotionLogo() {
  return (
    <svg width="78" height="20" viewBox="0 0 78 20" fill="none" aria-label="Notion">
      <rect x="0" y="0" width="18" height="18" rx="3.5" fill="#000"/>
      <path d="M4 4v10l3-3 3 3V4M4 4h6" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <text x="22" y="14" fontFamily="system-ui,-apple-system,sans-serif" fontSize="13" fontWeight="700" fill="#1A1A1A">Notion</text>
    </svg>
  );
}

function GmailLogo() {
  return (
    <svg width="74" height="20" viewBox="0 0 74 20" fill="none" aria-label="Gmail">
      <rect x="0" y="3" width="18" height="14" rx="2" fill="#fff" stroke="#E5E7EB" strokeWidth="0.5"/>
      <path d="M0 5l9 7 9-7" stroke="#EA4335" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
      <text x="22" y="15" fontFamily="system-ui,-apple-system,sans-serif" fontSize="13" fontWeight="700" fill="#5F6368">Gmail</text>
    </svg>
  );
}

function StripeLogo() {
  return (
    <svg width="72" height="20" viewBox="0 0 72 20" fill="none" aria-label="Stripe">
      <rect x="0" y="0" width="18" height="18" rx="4.5" fill="#635BFF"/>
      <path d="M9 5.5c-1.5 0-3 .7-3 2.3 0 3.2 4.5 2.4 4.5 3.8 0 .6-.6.9-1.5.9-1.2 0-2.4-.5-3.3-1.2v2.4c.9.5 2 .7 3.3.7 1.8 0 3.3-.9 3.3-2.5 0-3-4.5-2.5-4.5-3.7 0-.5.5-.8 1.3-.8 1 0 2.1.4 2.9 1V6.2C11 5.7 10 5.5 9 5.5z" fill="#fff"/>
      <text x="22" y="15" fontFamily="system-ui,-apple-system,sans-serif" fontSize="13" fontWeight="700" fill="#635BFF">Stripe</text>
    </svg>
  );
}

function SalesforceLogo() {
  return (
    <svg width="102" height="20" viewBox="0 0 102 20" fill="none" aria-label="Salesforce">
      <path d="M4 13.5a3.5 3.5 0 010-7c.4 0 .8.1 1.2.2a4 4 0 017.5-.7A3 3 0 0117 9.5a3 3 0 01-3 3H4z" fill="#00A1E0"/>
      <text x="22" y="15" fontFamily="system-ui,-apple-system,sans-serif" fontSize="13" fontWeight="700" fill="#00A1E0">Salesforce</text>
    </svg>
  );
}

// ─── Testimonial data ─────────────────────────────────────────────────────────
const testimonials = [
  {
    quote: "We replaced three separate Zapier setups with one Workliq workflow. It's been running for six weeks without a single failure. That used to be unimaginable.",
    name: "Elena Marsh",
    role: "VP of Operations",
    company: "Clearline Health",
  },
  {
    quote: "Our CRM was a mess of half-synced data and manual updates. Workliq cleaned it up automatically. The ROI was visible inside the first week.",
    name: "Tom Byrd",
    role: "Head of RevOps",
    company: "Signalpath",
  },
  {
    quote: "I kept saying we'd automate 'eventually'. Workliq made eventually happen in a Tuesday afternoon. We're saving at least 12 hours a week across the team.",
    name: "Priya Sharma",
    role: "Founder & CEO",
    company: "Loopback Studio",
  },
];

export default function Home() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [count] = useState(247);

  // Second CTA form
  const [ctaEmail, setCtaEmail] = useState("");
  const [ctaSubmitted, setCtaSubmitted] = useState(false);
  const [ctaLoading, setCtaLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !email) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, role }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        setLoading(false);
        return;
      }
      setSubmitted(true);
    } catch {
      setError("Network error — please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCtaSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ctaEmail) return;
    setCtaLoading(true);
    try {
      await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "", email: ctaEmail, role: "" }),
      });
      setCtaSubmitted(true);
    } catch {
      setCtaSubmitted(true);
    } finally {
      setCtaLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    flex: 1,
    fontSize: 13,
    padding: "8px 11px",
    borderRadius: 8,
    border: "0.5px solid #D1D5DB",
    background: "#F9FAFB",
    color: "#111827",
    outline: "none",
    width: "100%",
  };

  return (
    <main style={{ maxWidth: 700, margin: "0 auto", fontFamily: "system-ui, -apple-system, sans-serif", padding: "0 1.5rem" }}>

      {/* ── NAV ── */}
      <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1.2rem 0 0", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 28, height: 28, background: "#1A56DB", borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 500, color: "#fff" }}>W</div>
          <span style={{ fontSize: 15, fontWeight: 600, color: "#0D0F1A", letterSpacing: "-0.025em" }}>Workliq</span>
        </div>
        <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
          <a href="/about" style={{ fontSize: 13, color: "#6B7280", textDecoration: "none" }}>About</a>
          <a href="/pricing" style={{ fontSize: 13, color: "#6B7280", textDecoration: "none" }}>Pricing</a>
          <a href="/blog" style={{ fontSize: 13, color: "#6B7280", textDecoration: "none" }}>Blog</a>
          <span style={{ fontSize: 11, background: "#E6F1FB", color: "#0C447C", border: "0.5px solid #85B7EB", padding: "4px 11px", borderRadius: 20, whiteSpace: "nowrap" }}>Early access</span>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section style={{ padding: "4rem 0 2rem" }}>
        <div style={{ fontSize: 11, color: "#1A56DB", fontFamily: "monospace", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "1.4rem", display: "flex", alignItems: "center", gap: 8, animation: "fadeInUp 0.5s ease both" }}>
          <span style={{ display: "inline-block", width: 20, height: 1.5, background: "#1A56DB" }} />
          AI workflow automation
        </div>

        <h1 style={{ fontSize: "clamp(34px, 7.5vw, 56px)", fontWeight: 500, lineHeight: 1.06, letterSpacing: "-0.03em", marginBottom: "1.3rem", color: "#0D0F1A", animation: "fadeInUp 0.6s ease 0.1s both" }}>
          Your workflows,<br />
          <em style={{ fontStyle: "italic", color: "#1A56DB" }}>finally liquid.</em>
        </h1>

        <p style={{ fontSize: 16, color: "#6B7280", lineHeight: 1.7, maxWidth: 500, marginBottom: "2rem", animation: "fadeInUp 0.6s ease 0.2s both" }}>
          Workliq connects your tools and replaces manual, repetitive work with AI agents that run 24/7 — no engineers, no Zapier workarounds, no broken automations.
        </p>

        {/* ── WAITLIST FORM ── */}
        <div style={{ animation: "fadeInUp 0.6s ease 0.3s both" }}>
          {!submitted ? (
            <div style={{ background: "#fff", border: "0.5px solid #E5E7EB", borderRadius: 16, padding: "1.25rem", marginBottom: "1rem", boxShadow: "0 2px 16px rgba(0,0,0,0.04)" }}>
              <form onSubmit={handleSubmit}>
                <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                  <input
                    type="text"
                    placeholder="Your name"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    required
                    disabled={loading}
                    style={{ ...inputStyle, minWidth: 120 }}
                  />
                  <input
                    type="email"
                    placeholder="Work email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    disabled={loading}
                    style={{ ...inputStyle, minWidth: 160 }}
                  />
                </div>
                <select
                  value={role}
                  onChange={e => setRole(e.target.value)}
                  disabled={loading}
                  style={{ ...inputStyle, marginBottom: 10, cursor: "pointer", color: role ? "#111827" : "#6B7280" }}
                >
                  <option value="" disabled>What best describes you?</option>
                  <option>Founder / CEO</option>
                  <option>VP / Director of Operations</option>
                  <option>Head of RevOps</option>
                  <option>Marketing</option>
                  <option>Product / Engineering</option>
                  <option>Other</option>
                </select>

                {error && (
                  <div style={{ background: "#FCEBEB", border: "0.5px solid #F09595", borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "#791F1F", marginBottom: 10 }}>
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  style={{ width: "100%", padding: "11px", borderRadius: 9, border: "none", background: loading ? "#93AEED" : "#1A56DB", color: "#fff", fontSize: 13, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", transition: "background 0.15s", letterSpacing: "-0.01em", minHeight: 44 }}
                >
                  {loading ? "Joining waitlist…" : "Join the waitlist →"}
                </button>
              </form>

              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 12, color: "#6B7280" }}>
                <div style={{ display: "flex" }}>
                  {["#1A56DB", "#6366F1", "#0F6E56", "#E24B4A"].map((bg, i) => (
                    <div key={i} style={{ width: 22, height: 22, borderRadius: "50%", background: bg, border: "1.5px solid #fff", marginLeft: i === 0 ? 0 : -5, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 600, color: "#fff" }}>
                      {["A", "M", "S", "J"][i]}
                    </div>
                  ))}
                </div>
                <span>{count} people on the waitlist</span>
              </div>
            </div>
          ) : (
            <div style={{ background: "#fff", border: "0.5px solid #E5E7EB", borderRadius: 16, padding: "2rem", textAlign: "center", marginBottom: "1rem" }}>
              <div style={{ width: 48, height: 48, background: "#E6F1FB", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px", fontSize: 22, color: "#1A56DB" }}>✓</div>
              <div style={{ fontSize: 17, fontWeight: 500, color: "#0D0F1A", marginBottom: 6 }}>You&apos;re on the list.</div>
              <div style={{ fontSize: 13, color: "#6B7280", lineHeight: 1.6 }}>
                Check your inbox at <strong>{email}</strong> — we just sent a confirmation link. Click it to lock in your spot.
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── LOGO BAR ── */}
      <section style={{ borderTop: "0.5px solid #F0F1F3", borderBottom: "0.5px solid #F0F1F3", padding: "1.75rem 0", marginBottom: "0.5rem" }}>
        <div style={{ fontSize: 10, textAlign: "center", color: "#9CA3AF", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "1.25rem", fontWeight: 500 }}>
          Trusted by teams using
        </div>
        <div style={{ display: "flex", gap: 24, alignItems: "center", justifyContent: "center", flexWrap: "wrap", opacity: 0.7 }}>
          <SlackLogo />
          <HubSpotLogo />
          <NotionLogo />
          <GmailLogo />
          <StripeLogo />
          <SalesforceLogo />
        </div>
      </section>

      {/* ── TICKER ── */}
      <div style={{ overflow: "hidden", padding: "9px 0", marginBottom: "3rem" }}>
        <div style={{ display: "inline-block", whiteSpace: "nowrap", animation: "ticker 20s linear infinite", fontFamily: "monospace", fontSize: 11, color: "#9CA3AF", letterSpacing: "0.04em" }}>
          ✦ Lead enrichment &nbsp;&nbsp; ✦ Support triage &nbsp;&nbsp; ✦ CRM sync &nbsp;&nbsp; ✦ Invoice extraction &nbsp;&nbsp; ✦ Ops reporting &nbsp;&nbsp; ✦ Deal alerts &nbsp;&nbsp; ✦ Onboarding flows &nbsp;&nbsp; ✦ Ticket routing &nbsp;&nbsp; ✦ Weekly digests &nbsp;&nbsp; ✦ Lead enrichment &nbsp;&nbsp; ✦ Support triage &nbsp;&nbsp; ✦ CRM sync &nbsp;&nbsp; ✦ Invoice extraction &nbsp;&nbsp;
        </div>
      </div>

      {/* ── FEATURES ── */}
      <section style={{ marginBottom: "3rem" }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.75rem" }}>What Workliq does</div>
        <h2 style={{ fontSize: "clamp(20px, 3.5vw, 26px)", fontWeight: 500, color: "#0D0F1A", letterSpacing: "-0.02em", marginBottom: "1.5rem", lineHeight: 1.25 }}>
          Every tool connected.<br />Every workflow automated.
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }} className="feature-grid">
          {[
            { icon: "⚡", title: "Instant integrations", desc: "Connect Slack, HubSpot, Notion, Gmail and 200+ tools in minutes — OAuth, no code." },
            { icon: "🤖", title: "AI agents", desc: "Agents that understand context, make decisions, and complete multi-step tasks on their own." },
            { icon: "📊", title: "Live monitoring", desc: "Every automation run in real time — full audit trail, human override always available." },
            { icon: "🔒", title: "Enterprise security", desc: "SOC 2 ready, SSO, SAML, and audit logs built in. Your data never trains our models." },
          ].map((f, i) => (
            <div key={i} style={{ background: "#fff", border: "0.5px solid #E5E7EB", borderRadius: 14, padding: "16px 16px 14px" }}>
              <div style={{ width: 34, height: 34, background: "#EEF4FF", borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, marginBottom: 12 }}>{f.icon}</div>
              <h3 style={{ fontSize: 13, fontWeight: 600, color: "#0D0F1A", marginBottom: 6, letterSpacing: "-0.01em" }}>{f.title}</h3>
              <p style={{ fontSize: 12, color: "#6B7280", lineHeight: 1.6, margin: 0 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── SOCIAL PROOF ── */}
      <section style={{ marginBottom: "3rem" }}>
        <div style={{ textAlign: "center", marginBottom: "1.75rem" }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Social proof</div>
          <h2 style={{ fontSize: "clamp(20px, 3.5vw, 26px)", fontWeight: 500, color: "#0D0F1A", letterSpacing: "-0.025em", lineHeight: 1.2 }}>
            Join 247+ teams automating<br />their workflows with Workliq
          </h2>
        </div>

        {/* Metric cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 10, marginBottom: 16 }} className="metrics-grid">
          {[
            { value: "47k+", label: "automation runs / month", color: "#1A56DB" },
            { value: "98.1%", label: "workflow success rate", color: "#0F6E56" },
            { value: "4 min", label: "average setup time", color: "#6366F1" },
          ].map((m, i) => (
            <div key={i} style={{ background: "#F9FAFB", border: "0.5px solid #F0F1F3", borderRadius: 12, padding: "16px 14px", textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: m.color, marginBottom: 4, letterSpacing: "-0.04em" }}>{m.value}</div>
              <div style={{ fontSize: 11, color: "#6B7280", lineHeight: 1.4 }}>{m.label}</div>
            </div>
          ))}
        </div>

        {/* Ops-specific testimonials */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            {
              initials: "DC",
              bg: "#1A56DB",
              name: "David Chen",
              role: "Director of Operations",
              company: "Prism Analytics",
              quote: "We were spending 14 hours a week on CRM hygiene alone. Workliq cut that to zero. Our ops team now focuses on strategy, not data entry.",
            },
            {
              initials: "NV",
              bg: "#6366F1",
              name: "Natasha Voss",
              role: "RevOps Lead",
              company: "Helix SaaS",
              quote: "I evaluated six tools before Workliq. Nothing else connected HubSpot, Notion, and Slack the way we needed without custom code. Setup took one afternoon.",
            },
            {
              initials: "MW",
              bg: "#0D0F1A",
              name: "Marcus Webb",
              role: "Founder",
              company: "Clearfield Studio",
              quote: "Running a small team means every hour counts. Workliq now handles our client onboarding, invoicing follow-ups, and ops reporting — completely automatically.",
            },
          ].map((t, i) => (
            <div key={i} style={{ background: "#fff", border: "0.5px solid #E5E7EB", borderRadius: 12, padding: "16px 18px", display: "flex", gap: 14, alignItems: "flex-start" }}>
              <div style={{ width: 38, height: 38, borderRadius: "50%", background: t.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
                {t.initials}
              </div>
              <div>
                <p style={{ fontSize: 13, color: "#374151", lineHeight: 1.65, margin: "0 0 10px", fontStyle: "italic" }}>&ldquo;{t.quote}&rdquo;</p>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#0D0F1A", letterSpacing: "-0.01em" }}>{t.name}</div>
                <div style={{ fontSize: 11, color: "#6B7280" }}>{t.role}, {t.company}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section style={{ marginBottom: "3rem" }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.75rem" }}>How it works</div>
        <h2 style={{ fontSize: "clamp(20px, 3.5vw, 26px)", fontWeight: 500, color: "#0D0F1A", letterSpacing: "-0.02em", marginBottom: "1.75rem", lineHeight: 1.25 }}>
          From zero to automated<br />in minutes, not months.
        </h2>
        <div>
          {[
            {
              n: "1",
              emoji: "🔌",
              title: "Connect your tools",
              desc: "OAuth one-click integrations with Slack, HubSpot, Notion, Gmail, Stripe, and 200+ more. No API keys. No engineers. No reading docs.",
            },
            {
              n: "2",
              emoji: "⚙️",
              title: "Build your workflow",
              desc: "Describe what you want in plain English. Our AI assembles the workflow logic, maps data fields, and handles the edge cases you haven't thought of yet.",
            },
            {
              n: "3",
              emoji: "🤖",
              title: "AI runs 24/7",
              desc: "Your workflow goes live instantly. AI agents handle every trigger, monitor for failures, and escalate to a human only when genuinely needed.",
            },
          ].map((step, i) => (
            <div key={i} style={{ display: "flex", gap: 18, position: "relative" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0, width: 36 }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: i === 0 ? "#1A56DB" : "#EEF4FF", border: i === 0 ? "none" : "1px solid #BFDBFE", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: i === 0 ? "#fff" : "#1A56DB", flexShrink: 0, zIndex: 1 }}>
                  {step.n}
                </div>
                {i < 2 && (
                  <div style={{ width: 1.5, flex: 1, minHeight: 28, background: "linear-gradient(to bottom, #BFDBFE, #EEF4FF)", marginTop: 4 }} />
                )}
              </div>
              <div style={{ paddingBottom: i < 2 ? 32 : 0, paddingTop: 6 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: "#0D0F1A", marginBottom: 6, display: "flex", alignItems: "center", gap: 6, letterSpacing: "-0.01em" }}>
                  <span>{step.emoji}</span>{step.title}
                </h3>
                <p style={{ fontSize: 13, color: "#6B7280", lineHeight: 1.65, margin: 0 }}>{step.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── USE CASES ── */}
      <section style={{ marginBottom: "3rem" }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.75rem" }}>Built for real workflows</div>
        <h2 style={{ fontSize: "clamp(20px, 3.5vw, 26px)", fontWeight: 500, color: "#0D0F1A", letterSpacing: "-0.02em", marginBottom: "1.5rem", lineHeight: 1.25 }}>
          Every team has work<br />that should run itself.
        </h2>
        {[
          { n: "01", title: "Sales & CRM automation", desc: "Enrich leads the moment they enter HubSpot, draft follow-ups, update deal stages, and alert reps — automatically." },
          { n: "02", title: "Operations & finance", desc: "Extract data from invoices, reconcile records, flag anomalies, and generate weekly reports — without lifting a finger." },
          { n: "03", title: "Customer support triage", desc: "Classify tickets, draft first replies, escalate urgent issues, and close repetitive queries automatically." },
          { n: "04", title: "Marketing & content ops", desc: "Repurpose content, monitor brand mentions, and automate campaign reporting end-to-end." },
        ].map((uc, i) => (
          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 16, padding: "1rem 0", borderBottom: i < 3 ? "0.5px solid #F3F4F6" : "none" }}>
            <span style={{ fontFamily: "monospace", fontSize: 11, color: "#1A56DB", minWidth: 24, paddingTop: 3, fontWeight: 600 }}>{uc.n}</span>
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: "#0D0F1A", marginBottom: 4, letterSpacing: "-0.01em" }}>{uc.title}</h3>
              <p style={{ fontSize: 12, color: "#6B7280", lineHeight: 1.6, margin: 0 }}>{uc.desc}</p>
            </div>
          </div>
        ))}
      </section>

      {/* ── STATS ── */}
      <section style={{ marginBottom: "3rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 10 }} className="stats-grid">
          {[["214", "integrations"], ["48", "workflow templates"], ["4 min", "avg setup time"]].map(([v, l], i) => (
            <div key={i} style={{ background: "#F9FAFB", border: "0.5px solid #F0F1F3", borderRadius: 10, padding: "14px 12px", textAlign: "center" }}>
              <div style={{ fontSize: 26, fontWeight: 600, color: "#0D0F1A", marginBottom: 4, letterSpacing: "-0.03em" }}>{v}</div>
              <div style={{ fontSize: 11, color: "#9CA3AF" }}>{l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── TESTIMONIALS ── */}
      <section style={{ marginBottom: "3rem" }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.75rem" }}>What teams say</div>
        <h2 style={{ fontSize: "clamp(20px, 3.5vw, 26px)", fontWeight: 500, color: "#0D0F1A", letterSpacing: "-0.02em", marginBottom: "1.5rem", lineHeight: 1.25 }}>
          Real workflows.<br />Real results.
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {testimonials.map((t, i) => (
            <div key={i} style={{ background: "#fff", border: "0.5px solid #E5E7EB", borderRadius: 14, padding: "20px 20px 18px" }}>
              <div style={{ fontSize: 20, color: "#1A56DB", marginBottom: 10, lineHeight: 1 }}>&ldquo;</div>
              <p style={{ fontSize: 14, color: "#374151", lineHeight: 1.7, margin: "0 0 14px", fontStyle: "italic" }}>{t.quote}</p>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: ["#1A56DB", "#6366F1", "#0D0F1A"][i], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
                  {t.name.split(" ").map(n => n[0]).join("")}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#0D0F1A", letterSpacing: "-0.01em" }}>{t.name}</div>
                  <div style={{ fontSize: 11, color: "#6B7280" }}>{t.role}, {t.company}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── SECOND CTA ── */}
      <section style={{ background: "#0D0F1A", borderRadius: 20, padding: "2.75rem 2rem", marginBottom: "2.5rem", textAlign: "center" }}>
        <div style={{ fontSize: 10, fontFamily: "monospace", color: "#6366F1", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 14 }}>
          ✦ Join the waitlist
        </div>
        <h2 style={{ fontSize: "clamp(22px, 4vw, 30px)", fontWeight: 500, color: "#F0F2EE", letterSpacing: "-0.025em", lineHeight: 1.2, marginBottom: 10 }}>
          Ready to automate<br />your workflows?
        </h2>
        <p style={{ fontSize: 13, color: "#6B7280", lineHeight: 1.6, marginBottom: "1.5rem", maxWidth: 360, margin: "0 auto 1.5rem" }}>
          Join {count}+ teams who are replacing manual work with AI that runs while they sleep.
        </p>

        {!ctaSubmitted ? (
          <form onSubmit={handleCtaSubmit} style={{ maxWidth: 400, margin: "0 auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              type="email"
              placeholder="Work email address"
              value={ctaEmail}
              onChange={e => setCtaEmail(e.target.value)}
              required
              disabled={ctaLoading}
              style={{ flex: 1, fontSize: 13, padding: "11px 14px", borderRadius: 9, border: "0.5px solid #374151", background: "#161820", color: "#F0F2EE", outline: "none", minWidth: 200, minHeight: 44 }}
            />
            <button
              type="submit"
              disabled={ctaLoading}
              style={{ padding: "11px 20px", borderRadius: 9, border: "none", background: ctaLoading ? "#93AEED" : "#1A56DB", color: "#fff", fontSize: 13, fontWeight: 600, cursor: ctaLoading ? "not-allowed" : "pointer", whiteSpace: "nowrap", minHeight: 44 }}
            >
              {ctaLoading ? "Joining…" : "Get early access →"}
            </button>
          </form>
        ) : (
          <div style={{ fontSize: 14, color: "#6366F1", fontWeight: 500 }}>
            ✓ You&apos;re on the list — check your inbox.
          </div>
        )}

        <div style={{ marginTop: 20, fontSize: 11, color: "#4B5563", display: "flex", gap: 20, justifyContent: "center", flexWrap: "wrap" }}>
          <span>No credit card required</span>
          <span>·</span>
          <span>Free during beta</span>
          <span>·</span>
          <span>Cancel any time</span>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{ textAlign: "center", padding: "1.5rem 0 2rem", borderTop: "0.5px solid #F0F1F3", fontSize: 12, color: "#9CA3AF", fontFamily: "monospace" }}>
        © 2026 Workliq Inc. · Stockholm, Sweden ·{" "}
        <a href="/about" style={{ color: "#9CA3AF" }}>About</a> ·{" "}
        <a href="/pricing" style={{ color: "#9CA3AF" }}>Pricing</a> ·{" "}
        <a href="/blog" style={{ color: "#9CA3AF" }}>Blog</a> ·{" "}
        <a href="/terms" style={{ color: "#9CA3AF" }}>Terms</a> ·{" "}
        <a href="/privacy" style={{ color: "#9CA3AF" }}>Privacy</a>
      </footer>

      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(18px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes ticker {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        @media (max-width: 480px) {
          .feature-grid  { grid-template-columns: 1fr !important; }
          .stats-grid    { grid-template-columns: 1fr 1fr !important; }
          .metrics-grid  { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 375px) {
          .stats-grid    { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </main>
  );
}
