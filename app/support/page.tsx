"use client";

export default function Support() {
  const sections = [
    {
      title: "1. Contact Support",
      content: `Need help with Workliq? We're here for you.

Email: support@workliq.com
Response time: within 1 business day

For urgent issues affecting a live workflow, mention "urgent" in your subject line and we'll prioritize your request.`
    },
    {
      title: "2. Frequently Asked Questions",
      subsections: [
        {
          title: "2.1 How do I reset my password?",
          content: "Go to the login page and click \"Forgot password.\" You'll receive a reset link by email within a few minutes."
        },
        {
          title: "2.2 How do I disconnect an integration?",
          content: "Go to Settings → Integrations, find the integration, and click Disconnect. This revokes access immediately and pauses any workflows using it."
        },
        {
          title: "2.3 Why did my workflow stop running?",
          content: "The most common causes are a disconnected integration, an expired access token, or a change in the underlying data structure. Check the workflow's run history for details, or contact support."
        },
        {
          title: "2.4 How do I cancel or change my plan?",
          content: "You can manage your subscription from Settings → Billing. Changes take effect at the start of your next billing cycle."
        },
      ]
    },
    {
      title: "3. Reporting a Bug",
      content: `If something isn't working as expected, email support@workliq.com with:

• A short description of what happened
• What you expected to happen instead
• Steps to reproduce, if known
• Screenshots, if relevant

This helps us resolve issues faster.`
    },
    {
      title: "4. HubSpot Integration Support",
      content: "If you're experiencing issues with the HubSpot integration specifically — such as missing deal data or a failed connection — please include your HubSpot portal ID when contacting support so we can investigate quickly."
    },
    {
      title: "5. System Status",
      content: "For real-time status of Workliq services, visit our status page. We'll post updates there during any incidents or planned maintenance."
    },
    {
      title: "6. Security Issues",
      content: "If you believe you've found a security vulnerability, please email legal@workliq.com directly rather than filing a public report. We take security reports seriously and will respond promptly."
    },
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

      {/* HEADER */}
      <div style={{ padding: "3rem 0 2rem", borderBottom: "0.5px solid #E5E7EB", marginBottom: "2rem" }}>
        <div style={{ fontSize: 11, fontFamily: "monospace", color: "#1A56DB", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>Help</div>
        <h1 style={{ fontSize: 32, fontWeight: 500, color: "#0D0F1A", letterSpacing: "-0.02em", marginBottom: 8 }}>Support</h1>
        <p style={{ fontSize: 14, color: "#6B7280" }}>Answers to common questions, and how to reach us.</p>
      </div>

      {/* INTRO NOTE */}
      <div style={{ background: "#F0F6FF", border: "0.5px solid #BFDBFE", borderLeft: "3px solid #1A56DB", borderRadius: 8, padding: "12px 16px", marginBottom: "2rem", fontSize: 13, color: "#1E40AF", lineHeight: 1.6 }}>
        Can't find an answer below? Our team typically responds within one business day.
      </div>

      {/* TABLE OF CONTENTS */}
      <div style={{ background: "#F9FAFB", border: "0.5px solid #E5E7EB", borderRadius: 12, padding: "14px 18px", marginBottom: "2.5rem" }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Contents</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px" }}>
          {sections.map((s, i) => (
            <a key={i} href={`#section-${i}`} style={{ fontSize: 13, color: "#1A56DB", textDecoration: "none", padding: "2px 0", lineHeight: 1.5 }}>
              {s.title}
            </a>
          ))}
        </div>
      </div>

      {/* SECTIONS */}
      {sections.map((section, i) => (
        <div key={i} id={`section-${i}`} style={{ marginBottom: "2.5rem" }}>
          <h2 style={{ fontSize: 18, fontWeight: 500, color: "#0D0F1A", marginBottom: 12, paddingBottom: 8, borderBottom: "0.5px solid #E5E7EB" }}>
            {section.title}
          </h2>
          {section.content && (
            <p style={{ fontSize: 14, color: "#374151", lineHeight: 1.8, whiteSpace: "pre-line" }}>
              {section.content}
            </p>
          )}
          {section.subsections && section.subsections.map((sub, j) => (
            <div key={j} style={{ marginBottom: 18 }}>
              <h3 style={{ fontSize: 14, fontWeight: 500, color: "#1A56DB", marginBottom: 8 }}>{sub.title}</h3>
              <p style={{ fontSize: 14, color: "#374151", lineHeight: 1.8, whiteSpace: "pre-line" }}>{sub.content}</p>
            </div>
          ))}
        </div>
      ))}

      {/* CONTACT CARD */}
      <div style={{ background: "#F0F6FF", border: "0.5px solid #BFDBFE", borderRadius: 12, padding: "16px 20px", marginBottom: "2rem" }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: "#1E40AF", marginBottom: 8 }}>Still need help?</div>
        <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.7 }}>
          Email us at{" "}
          <a href="mailto:support@workliq.com" style={{ color: "#1A56DB" }}>support@workliq.com</a>
          {" "}and we will respond within 1 business day.
        </div>
      </div>

      {/* FOOTER */}
      <footer style={{ textAlign: "center", padding: "2rem 0", borderTop: "0.5px solid #E5E7EB", fontSize: 12, color: "#9CA3AF", fontFamily: "monospace" }}>
        © 2026 Workliq Inc. · workliq.com ·{" "}
        <a href="/terms" style={{ color: "#9CA3AF" }}>Terms of Service</a>
      </footer>
    </main>
  );
}
