"use client";

import { useState } from "react";

export default function Home() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [count] = useState(247);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !email) return;
    setSubmitted(true);
  }

  return (
    <main style={{ maxWidth: 680, margin: "0 auto", fontFamily: "system-ui, -apple-system, sans-serif", padding: "0 1.5rem" }}>

      {/* NAV */}
      <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1.2rem 0 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 28, height: 28, background: "#1A56DB", borderRadius: 7,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 13, fontWeight: 500, color: "#fff"
          }}>W</div>
          <span style={{ fontSize: 15, fontWeight: 500, color: "#0D0F1A", letterSpacing: "-0.02em" }}>Workliq</span>
        </div>
        <span style={{
          fontSize: 11, background: "#E6F1FB", color: "#0C447C",
          border: "0.5px solid #85B7EB", padding: "3px 10px", borderRadius: 20
        }}>Early access</span>
      </nav>

      {/* HERO */}
      <section style={{ padding: "3.5rem 0 2rem" }}>
        <div style={{
          fontSize: 12, color: "#1A56DB", fontFamily: "monospace",
          letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "1.2rem",
          display: "flex", alignItems: "center", gap: 8
        }}>
          <span style={{ display: "inline-block", width: 20, height: 1.5, background: "#1A56DB" }} />
          AI workflow automation
        </div>

        <h1 style={{
          fontSize: "clamp(32px, 7vw, 48px)", fontWeight: 500, lineHeight: 1.08,
          letterSpacing: "-0.025em", marginBottom: "1.2rem", color: "#0D0F1A"
        }}>
          Your workflows,<br />
          <em style={{ fontStyle: "italic", color: "#1A56DB" }}>finally liquid.</em>
        </h1>

        <p style={{
          fontSize: 16, color: "#6B7280", lineHeight: 1.65,
          maxWidth: 480, marginBottom: "2rem"
        }}>
          Workliq connects your tools and replaces manual, repetitive work
          with AI agents that run 24/7 — no engineers, no Zapier workarounds,
          no broken automations.
        </p>

        {/* WAITLIST FORM */}
        {!submitted ? (
          <div style={{
            background: "#fff", border: "0.5px solid #E5E7EB",
            borderRadius: 16, padding: "1.25rem", marginBottom: "1rem"
          }}>
            <form onSubmit={handleSubmit}>
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <input
                  type="text"
                  placeholder="Your name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                  style={{
                    flex: 1, fontSize: 13, padding: "8px 11px",
                    borderRadius: 8, border: "0.5px solid #D1D5DB",
                    background: "#F9FAFB", color: "#111827", outline: "none"
                  }}
                />
                <input
                  type="email"
                  placeholder="Work email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  style={{
                    flex: 1, fontSize: 13, padding: "8px 11px",
                    borderRadius: 8, border: "0.5px solid #D1D5DB",
                    background: "#F9FAFB", color: "#111827", outline: "none"
                  }}
                />
              </div>
              <select
                value={role}
                onChange={e => setRole(e.target.value)}
                style={{
                  width: "100%", fontSize: 13, padding: "8px 11px",
                  borderRadius: 8, border: "0.5px solid #D1D5DB",
                  background: "#F9FAFB", color: "#6B7280",
                  marginBottom: 10, outline: "none"
                }}
              >
                <option value="" disabled>What best describes you?</option>
                <option>Founder / CEO</option>
                <option>VP / Director of Operations</option>
                <option>Head of RevOps</option>
                <option>Marketing</option>
                <option>Product / Engineering</option>
                <option>Other</option>
              </select>
              <button
                type="submit"
                style={{
                  width: "100%", padding: "10px", borderRadius: 8,
                  border: "none", background: "#1A56DB", color: "#fff",
                  fontSize: 13, fontWeight: 500, cursor: "pointer"
                }}
              >
                Join the waitlist →
              </button>
            </form>

            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 12, color: "#6B7280" }}>
              <div style={{ display: "flex" }}>
                {["#1A56DB","#6366F1","#0F6E56","#E24B4A"].map((bg, i) => (
                  <div key={i} style={{
                    width: 22, height: 22, borderRadius: "50%", background: bg,
                    border: "1.5px solid #fff", marginLeft: i === 0 ? 0 : -5,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 8, fontWeight: 500, color: "#fff"
                  }}>
                    {["A","M","S","J"][i]}
                  </div>
                ))}
              </div>
              <span>{count} people on the waitlist</span>
            </div>
          </div>
        ) : (
          <div style={{
            background: "#fff", border: "0.5px solid #E5E7EB",
            borderRadius: 16, padding: "2rem", textAlign: "center", marginBottom: "1rem"
          }}>
            <div style={{
              width: 44, height: 44, background: "#E6F1FB", borderRadius: "50%",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 10px", fontSize: 20, color: "#1A56DB"
            }}>✓</div>
            <div style={{ fontSize: 16, fontWeight: 500, color: "#0D0F1A", marginBottom: 5 }}>You&apos;re on the list.</div>
            <div style={{ fontSize: 13, color: "#6B7280" }}>
              We&apos;ll email you at <strong>{email}</strong> when your access is ready.
            </div>
          </div>
        )}
      </section>

      {/* TICKER */}
      <div style={{
        overflow: "hidden", borderTop: "0.5px solid #E5E7EB",
        borderBottom: "0.5px solid #E5E7EB", padding: "9px 0", marginBottom: "2.5rem"
      }}>
        <div style={{
          display: "inline-block", whiteSpace: "nowrap",
          animation: "ticker 18s linear infinite",
          fontFamily: "monospace", fontSize: 11, color: "#9CA3AF", letterSpacing: "0.04em"
        }}>
          ✦ Lead enrichment &nbsp;&nbsp; ✦ Support triage &nbsp;&nbsp; ✦ CRM sync &nbsp;&nbsp; ✦ Invoice extraction &nbsp;&nbsp; ✦ Ops reporting &nbsp;&nbsp; ✦ Deal alerts &nbsp;&nbsp; ✦ Onboarding flows &nbsp;&nbsp; ✦ Ticket routing &nbsp;&nbsp; ✦ Weekly digests &nbsp;&nbsp; ✦ Lead enrichment &nbsp;&nbsp; ✦ Support triage &nbsp;&nbsp; ✦ CRM sync &nbsp;&nbsp; ✦ Invoice extraction &nbsp;&nbsp; ✦ Ops reporting &nbsp;&nbsp;
        </div>
      </div>

      {/* FEATURES */}
      <section style={{ marginBottom: "2.5rem" }}>
        <div style={{ fontSize: 11, fontWeight: 500, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "1rem" }}>
          What Workliq does
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {[
            { icon: "⚡", title: "Instant integrations", desc: "Connect Slack, HubSpot, Notion, Gmail and 200+ tools in minutes — OAuth, no code." },
            { icon: "🤖", title: "AI agents", desc: "Agents that understand context, make decisions, and complete multi-step tasks on their own." },
            { icon: "📊", title: "Live monitoring", desc: "Every automation run in real time — full audit trail, human override always available." },
            { icon: "🔒", title: "Enterprise security", desc: "SOC 2 ready, SSO, SAML, and audit logs built in. Your data never trains our models." },
          ].map((f, i) => (
            <div key={i} style={{
              background: "#fff", border: "0.5px solid #E5E7EB",
              borderRadius: 12, padding: 14
            }}>
              <div style={{
                width: 32, height: 32, background: "#E6F1FB", borderRadius: 8,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 16, marginBottom: 10
              }}>{f.icon}</div>
              <h3 style={{ fontSize: 13, fontWeight: 500, color: "#0D0F1A", marginBottom: 5 }}>{f.title}</h3>
              <p style={{ fontSize: 12, color: "#6B7280", lineHeight: 1.5 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* USE CASES */}
      <section style={{ marginBottom: "2.5rem" }}>
        <div style={{ fontSize: 11, fontWeight: 500, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "1rem" }}>
          Built for real workflows
        </div>
        {[
          { n: "01", title: "Sales & CRM automation", desc: "Enrich leads the moment they enter HubSpot, draft follow-ups, update deal stages, and alert reps — automatically." },
          { n: "02", title: "Operations & finance", desc: "Extract data from invoices, reconcile records, flag anomalies, and generate weekly reports — without lifting a finger." },
          { n: "03", title: "Customer support triage", desc: "Classify tickets, draft first replies, escalate urgent issues, and close repetitive queries automatically." },
          { n: "04", title: "Marketing & content ops", desc: "Repurpose content, monitor brand mentions, and automate campaign reporting end-to-end." },
        ].map((uc, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "flex-start", gap: 14,
            padding: "1rem 0", borderBottom: i < 3 ? "0.5px solid #E5E7EB" : "none"
          }}>
            <span style={{ fontFamily: "monospace", fontSize: 11, color: "#1A56DB", minWidth: 24, paddingTop: 2 }}>{uc.n}</span>
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 500, color: "#0D0F1A", marginBottom: 4 }}>{uc.title}</h3>
              <p style={{ fontSize: 12, color: "#6B7280", lineHeight: 1.55 }}>{uc.desc}</p>
            </div>
          </div>
        ))}
      </section>

      {/* STATS */}
      <section style={{ marginBottom: "2.5rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 10 }}>
          {[["214","integrations"],["48","workflow templates"],["4 min","avg setup time"]].map(([v,l], i) => (
            <div key={i} style={{ background: "#F9FAFB", borderRadius: 8, padding: 12, textAlign: "center" }}>
              <div style={{ fontSize: 24, fontWeight: 500, color: "#0D0F1A", marginBottom: 3 }}>{v}</div>
              <div style={{ fontSize: 11, color: "#9CA3AF" }}>{l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{
        textAlign: "center", padding: "1.5rem 0",
        borderTop: "0.5px solid #E5E7EB",
        fontSize: 12, color: "#9CA3AF", fontFamily: "monospace"
      }}>
        © 2026 Workliq · workliq.com · hello@workliq.com
      </footer>

      <style>{`
        @keyframes ticker {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </main>
  );
}
