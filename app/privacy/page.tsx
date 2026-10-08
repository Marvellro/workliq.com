"use client";

export default function Privacy() {
  const sections = [
    {
      title: "1. Who We Are",
      content: `Workliq Inc. ("Workliq," "we," "us," or "our") operates the Workliq workflow automation platform accessible at workliq.com. We are the data controller for the personal data we collect about visitors and users.

Data Protection contact: privacy@workliq.com`
    },
    {
      title: "2. Information We Collect",
      subsections: [
        {
          title: "2.1 Information you provide",
          content: `• Account information: name, email address, company name, and role when you sign up
• Billing information: payment details processed and stored securely by Stripe — we do not store card numbers
• Profile information: preferences, settings, and content you create within the platform
• Communications: emails and messages you send us, including support requests`
        },
        {
          title: "2.2 Information collected automatically",
          content: `• Usage data: the workflows you create, and a record of each time one runs and what the outcome was
• Security log: for sign-ins, integration connections and other security-relevant actions, we record what happened, when, the IP address it came from and the browser user-agent string
• Cookies: described in Section 8 below

We do not set device identifiers, do not record which page referred you, and do not build a profile of your browsing. Our hosting provider keeps its own standard server access logs, as any web host does.`
        },
        {
          title: "2.3 Information from third parties",
          content: `Workliq connects to three services: HubSpot, Slack and Notion. When you connect one, we receive and store an access token for it, encrypted as described in Section 9.

From HubSpot we read deal records — name, stage, owner and the date of last recorded activity — to decide whether a workflow should run. We store the deal identifier, name and stage on each workflow run so you can see what happened and so the same event does not fire twice.

To Slack and Notion we send only the content your workflow produces, to the channel or database you chose.

We do not read your HubSpot contacts, emails, call records or note contents.`
        },
      ]
    },
    {
      title: "3. How We Use Your Information",
      content: `We use the information we collect to:

• Provide, operate, and maintain the Workliq platform
• Process transactions and send billing-related communications
• Respond to your comments, questions, and support requests
• Send product updates, security notices, and administrative messages
• Monitor and analyse usage patterns to improve the Service
• Detect and prevent fraud, abuse, or security incidents
• Comply with legal obligations
• Send marketing communications where you have opted in (you can opt out at any time)`
    },
    {
      title: "4. Legal Basis for Processing (EU/UK Users)",
      content: `If you are located in the European Economic Area (EEA) or United Kingdom, we process your personal data on the following legal bases:

Contract — Processing necessary to provide the Service you have subscribed to.

Legitimate interests — Processing for fraud prevention, security, product improvement, and analytics, balanced against your rights.

Consent — Marketing communications, which you can withdraw at any time.

Legal obligation — Processing required to comply with applicable law.`
    },
    {
      title: "5. How We Share Your Information",
      subsections: [
        {
          title: "5.1 Service providers",
          content: `We share information with trusted third-party vendors who help us operate the Service, including:

• Stripe — payment processing and subscription billing
• Supabase — database hosting and authentication
• Vercel — application hosting
• Resend — transactional email delivery
• Anthropic — AI processing for workflow steps you configure, described in full in Section 6

This list is complete. We do not use product analytics or error-monitoring services, and no advertising or tracking service receives your data.`
        },
        {
          title: "5.2 Business transfers",
          content: "If Workliq is involved in a merger, acquisition, or sale of assets, your information may be transferred as part of that transaction. We will notify you via email and prominent notice on our website before your data is transferred and becomes subject to a different privacy policy."
        },
        {
          title: "5.3 Legal requirements",
          content: "We may disclose your information where required by law, regulation, legal process, or governmental request, or where necessary to protect the rights, property, or safety of Workliq, our users, or others."
        },
        {
          title: "5.4 With your consent",
          content: "We will share your information with third parties when you have given explicit consent for us to do so."
        },
      ]
    },
    {
      title: "6. AI Processing",
      content: `Some workflow steps use AI to write text — for example drafting a follow-up email or summarising a deal. An AI step runs only if you add one to a workflow, and only on the deals that workflow matches. Accounts on the Free plan have no AI budget, so no AI step runs and nothing described here is sent.

Our AI sub-processor is Anthropic, PBC.

What is sent

When an AI step runs, exactly the following leaves our infrastructure:

• The deal name
• The deal's current stage
• The deal owner's name
• A one-sentence description of what triggered the workflow
• The number of days since the deal's last recorded activity — only when staleness is what triggered the workflow
• Any additional instruction you typed into that workflow step, passed through as written

That list is exhaustive.

What is never sent

Contact records, email addresses, phone numbers, the contents of notes, emails or calls, deal amounts, and every other field in your CRM. Data about your own customers is not sent to the model.

The payload is built as a fixed set of named fields rather than by forwarding a CRM record, so broadening what Workliq reads from HubSpot cannot quietly increase what is sent. Adding a field is a deliberate change to that list.

Because the final item above is free text you write, please do not type personal data into a workflow instruction unless you intend it to be sent.

What comes back, and where it is kept

The generated text is delivered to the Slack channel or Notion database your workflow names. A copy is also stored against the workflow run in our database, so that a delivery which fails partway can be retried without losing what was already generated, and so you can see what was produced. It is retained as described in Section 7.

We also record the token counts and the cost of each call. Those records contain no deal data and no generated text.

Model training

Under Anthropic's commercial terms, inputs and outputs submitted through its API are not used to train its models.`
    },
    {
      title: "7. Data Retention",
      content: `We retain your personal data for as long as your account is active.

Deleted automatically

• Completed background jobs — 30 days after they finish
• Rate-limiting counters — after 24 hours

Retained for the life of the account

• Account details and workflow configuration
• Workflow run history: the deal identifier, name and stage for each run, and any text an AI step generated
• Records of events received from HubSpot and Stripe
• AI usage records — token counts and cost, with no deal data or generated text
• The security audit log

We want to be plain about this rather than imply more than we do: apart from the two items above, nothing is currently deleted on a schedule. If that changes we will say so here.

On request

You may ask us to delete your personal data at any time, and we will do so within 30 days. Billing records are the exception: we keep those for 7 years to meet financial reporting obligations.

Disconnecting an integration removes the stored access token for it.`
    },
    {
      title: "8. Cookies",
      content: `Workliq sets only the cookies it needs in order to work. These are the complete set:

sb-access-token and sb-refresh-token — keep you signed in between requests. Both are HTTP-only, so page scripts cannot read them.

hubspot_oauth_state, slack_oauth_state and notion_oauth_state — short-lived random values that let us confirm an integration connection you started is the one that came back, which is what prevents someone else's connection being attached to your account. Each is cleared the moment that connection finishes.

We use no analytics cookies, no advertising cookies and no third-party trackers, so there is nothing here to opt out of. Blocking these cookies will prevent you from signing in.`
    },
    {
      title: "9. Data Security",
      content: `We implement appropriate technical and organisational measures to protect your personal data:

• Encryption of data in transit (TLS 1.2+) and at rest (AES-256)
• Third-party credentials (HubSpot, Slack, Notion) encrypted with AES-256-GCM at the application layer, so they cannot be read from the database alone
• Row-level access controls restricting each account to its own data
• An audit log of security-relevant events, which the application only ever appends to
• Incident response procedures with breach notification within 72 hours of discovery

Despite these measures, no transmission over the internet is completely secure. If you believe your account has been compromised, please contact us immediately at privacy@workliq.com.`
    },
    {
      title: "10. Your Rights",
      content: `Depending on your location, you may have the following rights regarding your personal data:

Access — Request a copy of the personal data we hold about you.

Rectification — Request correction of inaccurate or incomplete personal data.

Erasure — Request deletion of your personal data, subject to legal retention requirements.

Portability — Request your personal data in a structured, machine-readable format.

Objection — Object to processing based on legitimate interests.

Restriction — Request restriction of processing in certain circumstances.

Opt-out of marketing — Unsubscribe from marketing emails at any time via the link in each email.

To exercise any of these rights, please contact us at privacy@workliq.com. We will respond within 30 days.`
    },
    {
      title: "11. International Transfers",
      content: "Workliq may transfer your personal data to countries with different data protection laws. When we transfer data internationally, we rely on EU Standard Contractual Clauses for transfers from the EEA, UK International Data Transfer Agreements for transfers from the UK, and adequacy decisions where applicable."
    },
    {
      title: "12. Children's Privacy",
      content: "The Service is not directed at individuals under the age of 18. We do not knowingly collect personal data from children. If you become aware that a child has provided us with personal data, please contact us at privacy@workliq.com and we will take steps to delete it."
    },
    {
      title: "13. Changes to This Policy",
      content: "We may update this Privacy Policy from time to time. We will notify you of material changes by email or by prominent notice on the Service at least 30 days before the changes take effect. Your continued use of the Service after changes take effect constitutes acceptance of the updated policy."
    },
    {
      title: "14. Contact Us",
      content: `If you have any questions about this Privacy Policy or our data practices, please contact us:

Workliq Inc.
Email: privacy@workliq.com
Website: workliq.com

If you are in the EEA or UK and are not satisfied with our response, you have the right to lodge a complaint with your local supervisory authority.`
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
        <h1 style={{ fontSize: 32, fontWeight: 500, color: "#0D0F1A", letterSpacing: "-0.02em", marginBottom: 8 }}>Privacy Policy</h1>
        <p style={{ fontSize: 14, color: "#6B7280" }}>Effective date: June 12, 2026 · Version 1.0</p>
      </div>

      {/* INTRO NOTE */}
      <div style={{ background: "#F0F6FF", border: "0.5px solid #BFDBFE", borderLeft: "3px solid #1A56DB", borderRadius: 8, padding: "12px 16px", marginBottom: "2rem", fontSize: 13, color: "#1E40AF", lineHeight: 1.6 }}>
        This Privacy Policy explains how Workliq collects, uses, stores, and shares information about you when you use our platform and services. We are committed to protecting your privacy and being transparent about our data practices.
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
        <div style={{ fontSize: 13, fontWeight: 500, color: "#1E40AF", marginBottom: 8 }}>Questions about your privacy?</div>
        <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.7 }}>
          Email us at{" "}
          <a href="mailto:privacy@workliq.com" style={{ color: "#1A56DB" }}>privacy@workliq.com</a>
          {" "}and we will respond within 30 days.
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
