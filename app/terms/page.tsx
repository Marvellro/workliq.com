"use client";

export default function Terms() {
  const sections = [
    {
      title: "1. Acceptance of Terms",
      content: `By accessing or using Workliq ("Service," "Platform," or "we/us/our"), you ("User," "Customer," or "you") agree to be bound by these Terms of Service ("Terms"). If you are using Workliq on behalf of a company or other legal entity, you represent that you have authority to bind that entity to these Terms.

If you do not agree to these Terms, you may not use the Service. We reserve the right to update these Terms at any time. We will notify you of material changes via email or prominent notice in the platform at least 30 days before they take effect.`
    },
    {
      title: "2. Description of Service",
      content: `Workliq is an AI-powered workflow automation platform that allows businesses to connect software tools, build automated workflows, deploy AI agents, and manage operational processes. The Service includes:

• A no-code workflow builder with AI step capabilities
• AI agents for autonomous task execution
• Integration connections to third-party software tools
• A template library of pre-built workflow automations
• Analytics, monitoring, and reporting dashboards
• A white-label reseller program for agency partners
• A public API for programmatic access`
    },
    {
      title: "3. Account Registration",
      subsections: [
        { title: "3.1 Eligibility", content: "You must be at least 18 years old and legally capable of entering into a binding contract to use the Service. The Service is intended for business use and not for personal or consumer use." },
        { title: "3.2 Account security", content: "You are responsible for maintaining the confidentiality of your account credentials. You must notify us immediately at legal@workliq.com if you become aware of any unauthorised use of your account. We are not liable for any loss resulting from unauthorised use of your account that occurs before you notify us." },
        { title: "3.3 Accurate information", content: "You agree to provide accurate, current, and complete information when creating your account and to keep it up to date. We reserve the right to suspend or terminate accounts based on inaccurate or incomplete information." },
      ]
    },
    {
      title: "4. Subscriptions and Billing",
      subsections: [
        { title: "4.1 Plans", content: "Workliq offers paid subscription plans (Starter, Growth, Enterprise) and a limited free tier. Feature access and usage limits depend on your plan. Detailed pricing is available at workliq.com/pricing." },
        { title: "4.2 Payment", content: "Paid plans are billed in advance on a monthly or annual basis via Stripe. By providing payment information, you authorise us to charge the applicable fees to your payment method. All fees are exclusive of applicable taxes, which you are responsible for paying." },
        { title: "4.3 Upgrades and downgrades", content: "You may upgrade your plan at any time and the change takes effect immediately, with a prorated charge for the remainder of the billing period. Downgrades take effect at the end of the current billing cycle." },
        { title: "4.4 Refunds", content: "All fees are non-refundable except where required by applicable law. If you cancel your subscription, you will continue to have access to the Service until the end of your current billing period. We do not provide partial-period refunds." },
        { title: "4.5 Late payment", content: "If payment fails, we will attempt to notify you and retry the charge. Accounts with overdue payments may be suspended after 7 days. Suspended accounts retain their data for 30 days before permanent deletion." },
      ]
    },
    {
      title: "5. Acceptable Use",
      content: `You may use the Service for your internal business purposes, including automating workflows, connecting business tools, and building operational processes for your organisation or, if you are an agency partner, for your clients.

You agree not to use the Service to:
• Violate any applicable law or regulation
• Infringe on the intellectual property rights of others
• Transmit malware, viruses, or harmful code
• Engage in spamming, phishing, or unsolicited mass communications
• Scrape, crawl, or harvest data from third-party services in violation of their terms
• Reverse engineer, decompile, or disassemble any part of the Service
• Resell or sublicense the Service except under our authorised white-label programme
• Use the Service in any way that could damage, overburden, or impair our infrastructure`
    },
    {
      title: "6. Integrations and Third-Party Services",
      content: "The Service allows you to connect third-party applications (\"Integrations\"). When you connect a third-party service, you authorise Workliq to access and interact with that service on your behalf, subject to the third party's terms of service. We are not responsible for the availability, accuracy, or conduct of third-party services."
    },
    {
      title: "7. Data and Privacy",
      subsections: [
        { title: "7.1 Customer data", content: "\"Customer Data\" means all data you input into the Service. You retain all ownership rights to your Customer Data." },
        { title: "7.2 Data processing", content: "You are the data controller for any personal data contained in your Customer Data. We act as a data processor on your behalf. If you process personal data of individuals in the EU or UK, you may request our Data Processing Agreement (DPA) at privacy@workliq.com." },
        { title: "7.3 Data security", content: "We implement industry-standard technical and organisational measures to protect Customer Data, including encryption at rest and in transit, access controls, and audit logging." },
      ]
    },
    {
      title: "8. Intellectual Property",
      subsections: [
        { title: "8.1 Our IP", content: "The Service and all associated content, features, and functionality are owned by Workliq Inc. and protected by applicable intellectual property laws. These Terms do not grant you any ownership interest in the Service." },
        { title: "8.2 Your IP", content: "You retain all rights to your Customer Data and any content you create using the Service. You grant us a limited, non-exclusive licence to use your Customer Data solely to provide the Service." },
        { title: "8.3 Feedback", content: "If you provide feedback or suggestions about the Service, you grant us an irrevocable, royalty-free licence to use that feedback for any purpose without attribution or compensation." },
      ]
    },
    {
      title: "9. Warranties and Disclaimers",
      content: "THE SERVICE IS PROVIDED \"AS IS\" AND \"AS AVAILABLE\" WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT. We do not warrant that the Service will be uninterrupted or error-free."
    },
    {
      title: "10. Limitation of Liability",
      content: "TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, WORKLIQ INC. SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES. OUR TOTAL CUMULATIVE LIABILITY SHALL NOT EXCEED THE GREATER OF (A) THE AMOUNTS PAID BY YOU IN THE TWELVE MONTHS PRECEDING THE CLAIM OR (B) ONE HUNDRED US DOLLARS ($100)."
    },
    {
      title: "11. Termination",
      subsections: [
        { title: "11.1 By you", content: "You may cancel your subscription at any time through your account settings or by contacting us at legal@workliq.com." },
        { title: "11.2 By us", content: "We may suspend or terminate your account immediately if you materially breach these Terms or engage in fraudulent activity." },
        { title: "11.3 Effect of termination", content: "On termination, we will retain your Customer Data for 30 days, during which you may export it. After 30 days, we will delete your data from our active systems." },
      ]
    },
    {
      title: "12. Governing Law",
      content: "These Terms are governed by and construed in accordance with applicable law. Any dispute arising from these Terms shall be resolved through binding arbitration, except that either party may seek injunctive relief in any court of competent jurisdiction."
    },
    {
      title: "13. Contact",
      content: "For questions about these Terms, please contact us at:\n\nWorkliq Inc.\nEmail: legal@workliq.com\nWebsite: workliq.com"
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
        <div style={{ fontSize: 11, fontFamily: "monospace", color: "#1A56DB", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>Legal</div>
        <h1 style={{ fontSize: 32, fontWeight: 500, color: "#0D0F1A", letterSpacing: "-0.02em", marginBottom: 8 }}>Terms of Service</h1>
        <p style={{ fontSize: 14, color: "#6B7280" }}>Effective date: June 12, 2026 · Version 1.0</p>
      </div>

      {/* INTRO NOTE */}
      <div style={{ background: "#F0F6FF", border: "0.5px solid #BFDBFE", borderLeft: "3px solid #1A56DB", borderRadius: 8, padding: "12px 16px", marginBottom: "2rem", fontSize: 13, color: "#1E40AF", lineHeight: 1.6 }}>
        These Terms of Service govern your access to and use of the Workliq platform. By creating an account or using our services, you agree to be bound by these terms. Please read them carefully.
      </div>

      {/* SECTIONS */}
      {sections.map((section, i) => (
        <div key={i} style={{ marginBottom: "2rem" }}>
          <h2 style={{ fontSize: 18, fontWeight: 500, color: "#0D0F1A", marginBottom: 12, paddingBottom: 8, borderBottom: "0.5px solid #E5E7EB" }}>
            {section.title}
          </h2>
          {section.content && (
            <p style={{ fontSize: 14, color: "#374151", lineHeight: 1.75, whiteSpace: "pre-line" }}>
              {section.content}
            </p>
          )}
          {section.subsections && section.subsections.map((sub, j) => (
            <div key={j} style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 500, color: "#1A56DB", marginBottom: 6 }}>{sub.title}</h3>
              <p style={{ fontSize: 14, color: "#374151", lineHeight: 1.75 }}>{sub.content}</p>
            </div>
          ))}
        </div>
      ))}

      {/* FOOTER */}
      <footer style={{ textAlign: "center", padding: "2rem 0", borderTop: "0.5px solid #E5E7EB", fontSize: 12, color: "#9CA3AF", fontFamily: "monospace" }}>
        © 2026 Workliq Inc. · workliq.com ·{" "}
        <a href="/privacy" style={{ color: "#9CA3AF" }}>Privacy Policy</a>
      </footer>
    </main>
  );
}
