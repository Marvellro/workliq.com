"use client";
import { useState } from "react";

const PRICES = { starter: { monthly: 61, annual: 49 }, growth: { monthly: 186, annual: 149 } };

export default function Pricing() {
  const [annual, setAnnual] = useState(true);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState("");

  const faqs = [
    { q: "Can I change plans at any time?", a: "Yes — upgrade instantly, downgrade at end of billing cycle. Unused days are prorated automatically by Stripe." },
    { q: "Is there a free trial?", a: "Growth includes a 14-day free trial — no card required. Starter is permanently free up to 50 runs/month." },
    { q: "What happens if I exceed my run limit?", a: "We alert you at 80% and 100%. Workflows pause (not fail) until you upgrade or the cycle resets. No silent overages." },
    { q: "Are refunds available?", a: "All fees are non-refundable except where required by law. You keep access until the end of your billing period after cancelling." },
  ];

  async function handleCheckout(plan: "starter" | "growth") {
    const email = window.prompt("Enter your work email to continue:");
    if (!email) return;

    const key = `${plan}-${annual ? "annual" : "monthly"}`;
    setCheckoutLoading(key);
    setCheckoutError("");

    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, billing: annual ? "annual" : "monthly", email }),
      });

      const data = await res.json();

      if (!res.ok || !data.url) {
        setCheckoutError(data.error || "Something went wrong. Please try again.");
        return;
      }

      window.location.href = data.url;
    } catch {
      setCheckoutError("Network error — please check your connection and try again.");
    } finally {
      setCheckoutLoading(null);
    }
  }

  const billingLabel = annual ? "annual" : "monthly";

  return (
    <main style={{ maxWidth: 820, margin: "0 auto", fontFamily: "system-ui, -apple-system, sans-serif", padding: "0 1.5rem" }}>
      <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1.2rem 0 0", flexWrap: "wrap", gap: 10 }}>
        <a href="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
          <div style={{ width: 28, height: 28, background: "#1A56DB", borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 600, color: "#fff" }}>W</div>
          <span style={{ fontSize: 15, fontWeight: 600, color: "#0D0F1A", letterSpacing: "-0.025em" }}>Workliq</span>
        </a>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <a href="/about" style={{ fontSize: 13, color: "#6B7280", textDecoration: "none" }}>About</a>
          <a href="/blog" style={{ fontSize: 13, color: "#6B7280", textDecoration: "none" }}>Blog</a>
          <a href="/" style={{ fontSize: 13, color: "#6B7280", textDecoration: "none" }}>← Back to home</a>
        </div>
      </nav>

      <div style={{ textAlign: "center", margin: "3rem 0 2rem" }}>
        <h1 style={{ fontSize: "clamp(24px, 4vw, 32px)", fontWeight: 500, color: "#0D0F1A", marginBottom: 8, letterSpacing: "-0.025em" }}>Simple, transparent pricing</h1>
        <p style={{ fontSize: 14, color: "#6B7280", marginBottom: 20 }}>Start free. Scale as you grow. No hidden fees.</p>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, fontSize: 13, color: "#6B7280" }} className="pricing-toggle">
          <span style={{ color: annual ? "#9CA3AF" : "#0D0F1A", fontWeight: annual ? 400 : 600 }}>Monthly</span>
          <button
            onClick={() => setAnnual(!annual)}
            style={{ width: 40, height: 22, borderRadius: 11, border: "none", cursor: "pointer", background: annual ? "#1A56DB" : "#D1D5DB", position: "relative", transition: "background 0.2s", minWidth: 40 }}
            aria-label="Toggle billing period"
          >
            <span style={{ position: "absolute", top: 3, left: annual ? 21 : 3, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
          </button>
          <span style={{ color: annual ? "#0D0F1A" : "#9CA3AF", fontWeight: annual ? 600 : 400 }}>Annual</span>
          <span style={{ fontSize: 11, background: "#EAF3DE", color: "#27500A", border: "0.5px solid #97C459", padding: "3px 9px", borderRadius: 20 }}>Save 20%</span>
        </div>
      </div>

      {checkoutError && (
        <div style={{ background: "#FCEBEB", border: "0.5px solid #F09595", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#791F1F", marginBottom: 16, textAlign: "center" }}>
          {checkoutError}
        </div>
      )}

      {/* PLAN CARDS */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 12, marginBottom: 40 }} className="plan-grid">

        {/* STARTER */}
        <div style={{ background: "#fff", border: "0.5px solid #E5E7EB", borderRadius: 16, padding: 22, display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#0D0F1A", marginBottom: 4 }}>Starter</div>
          <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 16, lineHeight: 1.5 }}>For teams testing automation for the first time.</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 3, marginBottom: 2 }}>
            <span style={{ fontSize: 34, fontWeight: 600, color: "#0D0F1A", letterSpacing: "-0.03em" }}>${annual ? PRICES.starter.annual : PRICES.starter.monthly}</span>
            <span style={{ fontSize: 13, color: "#9CA3AF" }}>/mo</span>
          </div>
          <div style={{ fontSize: 11, color: "#3B6D11", marginBottom: 16 }}>
            {annual ? `Billed annually · save $${(PRICES.starter.monthly - PRICES.starter.annual) * 12}/yr` : "Switch to annual to save 20%"}
          </div>
          <button
            onClick={() => handleCheckout("starter")}
            disabled={checkoutLoading === `starter-${billingLabel}`}
            style={{ display: "block", width: "100%", padding: "10px", borderRadius: 9, border: "0.5px solid #D1D5DB", background: checkoutLoading === `starter-${billingLabel}` ? "#F3F4F6" : "#fff", color: "#111827", fontSize: 13, fontWeight: 600, cursor: checkoutLoading === `starter-${billingLabel}` ? "not-allowed" : "pointer", marginBottom: 16, textAlign: "center", minHeight: 44, transition: "background 0.15s" }}
          >
            {checkoutLoading === `starter-${billingLabel}` ? "Loading…" : "Get started →"}
          </button>
          <div style={{ height: "0.5px", background: "#E5E7EB", marginBottom: 14 }} />
          {["5 active workflows", "500 automation runs/mo", "10 integrations", "1 AI agent", "Email support"].map((f, i) => (
            <div key={i} style={{ display: "flex", gap: 7, fontSize: 12, color: "#374151", marginBottom: 7, alignItems: "flex-start" }}>
              <span style={{ color: "#3B6D11", flexShrink: 0, marginTop: 1 }}>✓</span>{f}
            </div>
          ))}
        </div>

        {/* GROWTH */}
        <div style={{ background: "#fff", border: "2px solid #1A56DB", borderRadius: 16, padding: 22, display: "flex", flexDirection: "column", position: "relative" }}>
          <div style={{ fontSize: 11, background: "#E6F1FB", color: "#0C447C", border: "0.5px solid #85B7EB", padding: "3px 10px", borderRadius: 20, alignSelf: "flex-start", marginBottom: 10, fontWeight: 600 }}>Most popular</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#0D0F1A", marginBottom: 4 }}>Growth</div>
          <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 16, lineHeight: 1.5 }}>For ops teams ready to automate seriously.</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 3, marginBottom: 2 }}>
            <span style={{ fontSize: 34, fontWeight: 600, color: "#0D0F1A", letterSpacing: "-0.03em" }}>${annual ? PRICES.growth.annual : PRICES.growth.monthly}</span>
            <span style={{ fontSize: 13, color: "#9CA3AF" }}>/mo</span>
          </div>
          <div style={{ fontSize: 11, color: "#3B6D11", marginBottom: 16 }}>
            {annual ? `Billed annually · save $${(PRICES.growth.monthly - PRICES.growth.annual) * 12}/yr` : "Switch to annual to save 20%"}
          </div>
          <button
            onClick={() => handleCheckout("growth")}
            disabled={checkoutLoading === `growth-${billingLabel}`}
            style={{ display: "block", width: "100%", padding: "10px", borderRadius: 9, border: "none", background: checkoutLoading === `growth-${billingLabel}` ? "#93AEED" : "#1A56DB", color: "#fff", fontSize: 13, fontWeight: 600, cursor: checkoutLoading === `growth-${billingLabel}` ? "not-allowed" : "pointer", marginBottom: 16, textAlign: "center", minHeight: 44, transition: "background 0.15s" }}
          >
            {checkoutLoading === `growth-${billingLabel}` ? "Loading…" : "Start free trial →"}
          </button>
          <div style={{ height: "0.5px", background: "#E5E7EB", marginBottom: 14 }} />
          {["Unlimited workflows", "10,000 runs/mo", "All 214 integrations", "5 AI agents", "Analytics dashboard", "Priority support"].map((f, i) => (
            <div key={i} style={{ display: "flex", gap: 7, fontSize: 12, color: "#374151", marginBottom: 7, alignItems: "flex-start" }}>
              <span style={{ color: "#3B6D11", flexShrink: 0, marginTop: 1 }}>✓</span>{f}
            </div>
          ))}
        </div>

        {/* ENTERPRISE */}
        <div style={{ background: "#fff", border: "0.5px solid #E5E7EB", borderRadius: 16, padding: 22, display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#0D0F1A", marginBottom: 4 }}>Enterprise</div>
          <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 16, lineHeight: 1.5 }}>For mid-market teams needing security and scale.</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 3, marginBottom: 2 }}>
            <span style={{ fontSize: 34, fontWeight: 600, color: "#0D0F1A", letterSpacing: "-0.03em" }}>Custom</span>
          </div>
          <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 16 }}>Tailored to your usage and team size</div>
          <a
            href="mailto:hello@workliq.com?subject=Enterprise enquiry"
            style={{ display: "block", width: "100%", padding: "10px", borderRadius: 9, border: "none", background: "#0D0F1A", color: "#C8F135", fontSize: 13, fontWeight: 600, cursor: "pointer", marginBottom: 16, textAlign: "center", textDecoration: "none", minHeight: 44, lineHeight: "24px", boxSizing: "border-box" }}
          >
            Talk to sales →
          </a>
          <div style={{ height: "0.5px", background: "#E5E7EB", marginBottom: 14 }} />
          {["Unlimited runs", "Unlimited AI agents", "SSO / SAML", "Audit logs (90 days)", "Dedicated CSM", "Custom SLA + uptime", "Custom contracts"].map((f, i) => (
            <div key={i} style={{ display: "flex", gap: 7, fontSize: 12, color: "#374151", marginBottom: 7, alignItems: "flex-start" }}>
              <span style={{ color: "#3B6D11", flexShrink: 0, marginTop: 1 }}>✓</span>{f}
            </div>
          ))}
        </div>
      </div>

      {/* FAQ */}
      <div style={{ marginBottom: 48 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: "#0D0F1A", marginBottom: 14, letterSpacing: "-0.01em" }}>Common questions</h2>
        {faqs.map((faq, i) => (
          <div key={i} style={{ border: "0.5px solid #E5E7EB", borderRadius: 9, marginBottom: 7, overflow: "hidden" }}>
            <button
              onClick={() => setOpenFaq(openFaq === i ? null : i)}
              style={{ width: "100%", padding: "12px 14px", background: "none", border: "none", fontSize: 13, color: "#111827", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", textAlign: "left", minHeight: 44 }}
            >
              <span>{faq.q}</span>
              <span style={{ fontSize: 16, color: "#9CA3AF", transform: openFaq === i ? "rotate(180deg)" : "none", transition: "transform 0.15s", flexShrink: 0, marginLeft: 8 }}>⌄</span>
            </button>
            {openFaq === i && (
              <div style={{ padding: "0 14px 12px", fontSize: 13, color: "#6B7280", lineHeight: 1.65 }}>{faq.a}</div>
            )}
          </div>
        ))}
      </div>

      <footer style={{ textAlign: "center", padding: "1.5rem 0 2rem", borderTop: "0.5px solid #E5E7EB", fontSize: 12, color: "#9CA3AF", fontFamily: "monospace" }}>
        © 2026 Workliq Inc. ·{" "}
        <a href="/" style={{ color: "#9CA3AF" }}>Home</a> ·{" "}
        <a href="/about" style={{ color: "#9CA3AF" }}>About</a> ·{" "}
        <a href="/blog" style={{ color: "#9CA3AF" }}>Blog</a> ·{" "}
        <a href="/terms" style={{ color: "#9CA3AF" }}>Terms</a> ·{" "}
        <a href="/privacy" style={{ color: "#9CA3AF" }}>Privacy</a>
      </footer>

      <style>{`
        @media (max-width: 640px) {
          .plan-grid { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 480px) {
          .pricing-toggle { flex-wrap: wrap !important; justify-content: center !important; }
        }
      `}</style>
    </main>
  );
}
