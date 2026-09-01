"use client";

export default function Docs() {
  const sections = [
    {
      title: "1. Getting Started",
      content: `Workliq is a workflow automation platform that lets you connect your tools and automate repetitive work in minutes.

To get started:

• Create a Workliq account at workliq.com
• Connect an integration (HubSpot, Slack, or Gmail)
• Choose a template or build a workflow from scratch
• Turn on your workflow and let it run`
    },
    {
      title: "2. Connecting HubSpot",
      subsections: [
        {
          title: "2.1 Installing the integration",
          content: `From your Workliq dashboard, go to Integrations → HubSpot and click Connect. You'll be redirected to HubSpot to approve access.

Workliq requests read access to your deals data so it can trigger workflows based on deal activity. We do not request write access to your CRM records.`
        },
        {
          title: "2.2 What data we access",
          content: "Workliq reads deal properties on a scheduled basis to power automations you configure. No deal data is modified, and nothing is shared outside the workflow steps you set up. See our Privacy Policy for full details on data handling."
        },
      ]
    },
    {
      title: "3. Building a Workflow",
      content: `Workflows in Workliq are made of triggers and actions:

• Triggers — an event that starts the workflow, such as a new deal or a scheduled time
• Actions — what happens next, such as sending a Slack message or updating a record
• Conditions — optional logic to branch your workflow based on data

You can build a workflow visually from the Workflows tab, or start from one of our templates.`
    },
    {
      title: "4. Managing Integrations",
      content: `You can view and manage connected integrations at any time from Settings → Integrations.

To disconnect an integration, click Disconnect next to its name. This immediately revokes Workliq's access token and stops any workflows relying on that integration.`
    },
    {
      title: "5. Troubleshooting",
      content: `Common issues:

• Workflow not triggering — check that the integration is still connected and the trigger conditions are correct
• Missing data in a step — confirm the integration has the required scopes approved
• Slow updates — some integrations sync on a schedule rather than in real time

If you're still stuck, contact us at support@workliq.com.`
    },
    {
      title: "6. API & Webhooks",
      content: "Workliq supports outbound webhooks so you can trigger external systems from a workflow. API access for building custom integrations is on our roadmap — reach out if you'd like early access."
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
        <div style={{ fontSize: 11, fontFamily: "monospace", color: "#1A56DB", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>Documentation</div>
        <h1 style={{ fontSize: 32, fontWeight: 500, color: "#0D0F1A", letterSpacing: "-0.02em", marginBottom: 8 }}>Docs</h1>
        <p style={{ fontSize: 14, color: "#6B7280" }}>Everything you need to get up and running with Workliq.</p>
      </div>

      {/* INTRO NOTE */}
      <div style={{ background: "#F0F6FF", border: "0.5px solid #BFDBFE", borderLeft: "3px solid #1A56DB", borderRadius: 8, padding: "12px 16px", marginBottom: "2rem", fontSize: 13, color: "#1E40AF", lineHeight: 1.6 }}>
        This documentation covers setup, integrations, and common workflows. It's a work in progress — let us know if something's missing.
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
        <div style={{ fontSize: 13, fontWeight: 500, color: "#1E40AF", marginBottom: 8 }}>Can't find what you're looking for?</div>
        <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.7 }}>
          Email us at{" "}
          <a href="mailto:support@workliq.com" style={{ color: "#1A56DB" }}>support@workliq.com</a>
          {" "}and we'll help you out.
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
