"use client";

export default function HubSpotSetupGuide() {
  const sections = [
    {
      title: "1. What This Integration Does",
      blocks: [
        { type: "text", text: `Workliq's HubSpot integration connects your HubSpot deals to Workliq's workflow automation platform. Once connected, Workliq can:

• Trigger automated workflows when a deal is created, updated, or moves stage
• Read deal properties to power conditional logic in your workflows
• Send notifications, update other tools, or run downstream automations based on deal activity

This integration is read-only with respect to your HubSpot CRM — Workliq does not create, edit, or delete deal records in HubSpot.` },
      ]
    },
    {
      title: "2. Install the App",
      blocks: [
        { type: "text", text: `To install the Workliq HubSpot integration:

• Log in to your Workliq account at workliq.com
• Navigate to Settings → Integrations
• Locate the HubSpot card and click Connect
• You'll be redirected to HubSpot to select the account you want to connect
• Choose your HubSpot account and click Choose Account` },
        { type: "image", src: "/images/hubspot-setup/account-selection.png", alt: "HubSpot account selection screen showing 'Choose an account'" },
        { type: "text", text: `• On the next screen, HubSpot will ask you to confirm the connection. Workliq requests read-only access to deals (crm.objects.deals.read) so it can trigger and inform workflows based on deal data — Workliq does not request write access to your CRM
• Click Connect app to approve` },
        { type: "image", src: "/images/hubspot-setup/connection-approval.png", alt: "HubSpot connection approval screen with Connect app button" },
        { type: "text", text: `• You'll be redirected back to Workliq, where the HubSpot integration will now show as Connected` },
      ]
    },
    {
      title: "3. Confirm the Connection",
      blocks: [
        { type: "text", text: `Once you approve the connection in HubSpot, you're redirected back to your Workliq dashboard, where HubSpot now appears under Connections with a Connected status and your HubSpot portal ID shown alongside it.` },
        { type: "image", src: "/images/hubspot-setup/connections-panel.png", alt: "Workliq Connections page showing HubSpot as Connected" },
        { type: "text", text: `No further setup or configuration is required at this step. There is no separate pipeline, stage, or property picker to fill in — Workliq is ready to use HubSpot deal data as soon as the connection shows as Connected.

Behind the scenes, Workliq runs a scheduled sync that checks your HubSpot deals for changes on a regular interval. This is fully automatic and requires no action from you.` },
      ]
    },
    {
      title: "4. Use the App",
      blocks: [
        { type: "text", text: `Once HubSpot shows as Connected, you can build workflows in Workliq that use your HubSpot deal data:

• Go to Workflows → New Workflow
• Select a HubSpot-based trigger (such as a deal update) as your starting point
• Add conditions based on deal properties available from the synced data (e.g. deal stage or amount)
• Add one or more actions to run automatically when the trigger fires (e.g. send a Slack message, add a row in Notion, call a webhook)

Because deal data is synced on a schedule rather than instantly, there may be a short delay between a change in HubSpot and a workflow reacting to it. Once a workflow is turned on, it runs automatically — no manual steps are required after setup.` },
      ]
    },
    {
      title: "5. Disconnect the App",
      blocks: [
        { type: "text", text: `Workliq does not currently have a separate "disconnect" button inside its own dashboard — the HubSpot connection is managed entirely from HubSpot's side. To remove Workliq's access to your HubSpot account, uninstall it directly from HubSpot:

• In HubSpot, go to Settings → Integrations → Connected Apps
• Find Workliq in your list of installed apps
• Click Actions next to Workliq, then click Uninstall` },
        { type: "image", src: "/images/hubspot-setup/uninstall-confirm.png", alt: "HubSpot 'Uninstall Workliq?' confirmation dialog" },
        { type: "text", text: `• Type "uninstall" in the confirmation field, then click Uninstall to confirm

This immediately revokes Workliq's access token. No data is deleted from your HubSpot account. In Workliq, any workflows relying on HubSpot data will stop running until you reconnect — no historical workflow run data in Workliq is affected.

To reconnect, repeat the install steps above from your Workliq dashboard.` },
      ]
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
        <a href="/docs" style={{ fontSize: 13, color: "#6B7280", textDecoration: "none" }}>← Back to docs</a>
      </nav>

      {/* HEADER */}
      <div style={{ padding: "3rem 0 2rem", borderBottom: "0.5px solid #E5E7EB", marginBottom: "2rem" }}>
        <div style={{ fontSize: 11, fontFamily: "monospace", color: "#1A56DB", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>Integration Setup Guide</div>
        <h1 style={{ fontSize: 32, fontWeight: 500, color: "#0D0F1A", letterSpacing: "-0.02em", marginBottom: 8 }}>Connecting HubSpot to Workliq</h1>
        <p style={{ fontSize: 14, color: "#6B7280" }}>A step-by-step guide to installing, using, and disconnecting the Workliq HubSpot integration.</p>
      </div>

      {/* INTRO NOTE */}
      <div style={{ background: "#F0F6FF", border: "0.5px solid #BFDBFE", borderLeft: "3px solid #1A56DB", borderRadius: 8, padding: "12px 16px", marginBottom: "2rem", fontSize: 13, color: "#1E40AF", lineHeight: 1.6 }}>
        This guide covers everything needed to connect, use, and disconnect the Workliq HubSpot integration. For general product help, visit our Docs or Support pages.
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
          {section.blocks.map((block, j) => (
            block.type === "text" ? (
              <p key={j} style={{ fontSize: 14, color: "#374151", lineHeight: 1.8, whiteSpace: "pre-line", marginBottom: 16 }}>
                {block.text}
              </p>
            ) : (
              <img
                key={j}
                src={block.src}
                alt={block.alt}
                style={{ width: "100%", borderRadius: 8, border: "0.5px solid #E5E7EB", marginBottom: 16, display: "block" }}
              />
            )
          ))}
        </div>
      ))}

      {/* CONTACT CARD */}
      <div style={{ background: "#F0F6FF", border: "0.5px solid #BFDBFE", borderRadius: 12, padding: "16px 20px", marginBottom: "2rem" }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: "#1E40AF", marginBottom: 8 }}>Need help with setup?</div>
        <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.7 }}>
          Email us at{" "}
          <a href="mailto:support@workliq.com" style={{ color: "#1A56DB" }}>support@workliq.com</a>
          {" "}and mention "HubSpot integration" so we can route you to the right person.
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
