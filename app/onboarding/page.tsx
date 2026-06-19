import Stripe from "stripe";
import Link from "next/link";

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: "2026-05-27.dahlia",
  });
}

const PLAN_NAMES: Record<string, string> = {
  starter: "Workliq Starter",
  growth: "Workliq Growth",
};

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id } = await searchParams;

  let email: string | null = null;
  let planLabel = "Workliq";
  let billing: string | null = null;
  let amount: string | null = null;
  let hasError = false;

  if (!session_id) {
    hasError = true;
  } else {
    try {
      const session = await getStripe().checkout.sessions.retrieve(session_id, {
        expand: ["subscription"],
      });

      if (session.status !== "complete") {
        hasError = true;
      } else {
        email = session.customer_details?.email ?? null;
        const sub = session.subscription as Stripe.Subscription | null;
        const plan = sub?.metadata?.plan;
        billing = sub?.metadata?.billing ?? null;
        if (plan && PLAN_NAMES[plan]) planLabel = PLAN_NAMES[plan];
        if (session.amount_total != null) {
          amount = (session.amount_total / 100).toLocaleString("en-US", {
            style: "currency",
            currency: session.currency?.toUpperCase() || "USD",
          });
        }
      }
    } catch {
      hasError = true;
    }
  }

  if (hasError) {
    return (
      <main style={{ maxWidth: 600, margin: "0 auto", fontFamily: "system-ui, -apple-system, sans-serif", padding: "6rem 1.5rem", textAlign: "center" }}>
        <h1 style={{ fontSize: 26, fontWeight: 500, color: "#0D0F1A", marginBottom: "1rem" }}>
          We couldn&apos;t confirm this subscription
        </h1>
        <p style={{ fontSize: 15, color: "#6B7280", lineHeight: 1.7, marginBottom: "2rem" }}>
          If you just completed checkout, this may be temporary — try refreshing. If it keeps happening, reach out and we&apos;ll sort it out right away.
        </p>
        <a href="mailto:hello@workliq.com" style={{ fontSize: 14, color: "#1A56DB", fontWeight: 600, textDecoration: "none" }}>
          Contact support →
        </a>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", fontFamily: "system-ui, -apple-system, sans-serif", padding: "0 1.5rem" }}>
      <nav style={{ display: "flex", alignItems: "center", gap: 8, padding: "1.2rem 0" }}>
        <div style={{ width: 28, height: 28, background: "#1A56DB", borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 500, color: "#fff" }}>
          W
        </div>
        <span style={{ fontSize: 15, fontWeight: 600, color: "#0D0F1A", letterSpacing: "-0.025em" }}>Workliq</span>
      </nav>

      <section style={{ padding: "3rem 0 1rem", textAlign: "center" }}>
        <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#E6F1FB", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 1.5rem" }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
            <path d="M5 13l4 4L19 7" stroke="#1A56DB" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        <div style={{ fontSize: 11, color: "#1A56DB", fontFamily: "monospace", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.8rem" }}>
          subscription confirmed
        </div>

        <h1 style={{ fontSize: "clamp(28px, 5vw, 38px)", fontWeight: 500, lineHeight: 1.15, marginBottom: "0.8rem", color: "#0D0F1A", letterSpacing: "-0.03em" }}>
          Welcome to {planLabel}.
        </h1>

        <p style={{ fontSize: 16, color: "#6B7280", lineHeight: 1.7, maxWidth: 460, margin: "0 auto" }}>
          {email ? `A receipt is on its way to ${email}.` : "Your subscription is active."}
        </p>
      </section>

      <section style={{ background: "#F9FAFB", border: "0.5px solid #E5E7EB", borderRadius: 14, padding: "1.5rem", margin: "1.5rem 0 3rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "0.5rem 0", fontSize: 14 }}>
          <span style={{ color: "#6B7280" }}>Plan</span>
          <span style={{ color: "#0D0F1A", fontWeight: 600 }}>{planLabel}</span>
        </div>
        {billing && (
          <div style={{ display: "flex", justifyContent: "space-between", padding: "0.5rem 0", fontSize: 14, borderTop: "0.5px solid #E5E7EB" }}>
            <span style={{ color: "#6B7280" }}>Billing</span>
            <span style={{ color: "#0D0F1A", fontWeight: 600 }}>{billing === "annual" ? "Annual" : "Monthly"}</span>
          </div>
        )}
        {amount && (
          <div style={{ display: "flex", justifyContent: "space-between", padding: "0.5rem 0", fontSize: 14, borderTop: "0.5px solid #E5E7EB" }}>
            <span style={{ color: "#6B7280" }}>Amount charged</span>
            <span style={{ color: "#0D0F1A", fontWeight: 600 }}>{amount}</span>
          </div>
        )}
      </section>

      <section style={{ paddingBottom: "3rem" }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: "#0D0F1A", marginBottom: "1rem", letterSpacing: "-0.01em" }}>What happens next</h2>
        {[
          { step: "1", title: "Connect your tools", body: "Link HubSpot, Slack, Notion, or any of your 214 supported integrations." },
          { step: "2", title: "Build your first workflow", body: "Start from a template, like CRM follow-up reminders or stale deal alerts." },
          { step: "3", title: "Turn it on", body: "Workliq runs in the background from here, 24/7, with no further setup." },
        ].map((item) => (
          <div key={item.step} style={{ display: "flex", gap: "1.1rem", padding: "1.1rem 0", borderBottom: "0.5px solid #E5E7EB" }}>
            <div style={{ flexShrink: 0, width: 30, height: 30, borderRadius: "50%", background: "#EEF4FF", border: "1px solid #BFDBFE", color: "#1A56DB", fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {item.step}
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: "#0D0F1A", marginBottom: "0.25rem", letterSpacing: "-0.01em" }}>{item.title}</div>
              <div style={{ fontSize: 13, color: "#6B7280", lineHeight: 1.6 }}>{item.body}</div>
            </div>
          </div>
        ))}
      </section>

      <section style={{ paddingBottom: "4rem", textAlign: "center" }}>
        <Link
          href="/"
          style={{ display: "inline-block", padding: "0.85rem 2.2rem", background: "#1A56DB", color: "#FFFFFF", borderRadius: 10, fontSize: 14, fontWeight: 600, textDecoration: "none" }}
        >
          Back to homepage →
        </Link>
        <div style={{ marginTop: "1rem", fontSize: 13, color: "#9CA3AF" }}>
          Questions? <a href="mailto:hello@workliq.com" style={{ color: "#1A56DB", textDecoration: "none" }}>hello@workliq.com</a>
        </div>
      </section>

      <footer style={{ textAlign: "center", padding: "1.5rem 0 2rem", borderTop: "0.5px solid #F0F1F3", fontSize: 12, color: "#9CA3AF", fontFamily: "monospace" }}>
        © 2026 Workliq Inc. · <a href="/terms" style={{ color: "#9CA3AF" }}>Terms</a> · <a href="/privacy" style={{ color: "#9CA3AF" }}>Privacy</a>
      </footer>
    </main>
  );
}
