export default function Confirmed() {
  return (
    <main style={{ maxWidth: 520, margin: "0 auto", fontFamily: "system-ui, sans-serif", padding: "0 1.5rem", textAlign: "center" }}>
      <div style={{ padding: "5rem 0" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 40 }}>
          <div style={{ width: 28, height: 28, background: "#1A56DB", borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 500, color: "#fff" }}>W</div>
          <span style={{ fontSize: 15, fontWeight: 500, color: "#0D0F1A" }}>Workliq</span>
        </div>
        <div style={{ width: 56, height: 56, background: "#E6F1FB", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", fontSize: 24, color: "#1A56DB" }}>✓</div>
        <h1 style={{ fontSize: 26, fontWeight: 500, color: "#0D0F1A", marginBottom: 10 }}>You&apos;re confirmed.</h1>
        <p style={{ fontSize: 15, color: "#6B7280", lineHeight: 1.7, maxWidth: 380, margin: "0 auto 32px" }}>
          Welcome to the Workliq waitlist. Check your inbox — we just sent you a welcome email from Marvellous. We&apos;ll be in touch as soon as your access is ready.
        </p>
        <a href="/" style={{ fontSize: 14, padding: "10px 24px", borderRadius: 8, background: "#1A56DB", color: "#fff", textDecoration: "none", fontWeight: 500 }}>
          Back to Workliq →
        </a>
        <p style={{ fontSize: 13, color: "#9CA3AF", marginTop: 32 }}>
          Know someone drowning in manual ops work?{" "}
          <a href="https://workliq.com" style={{ color: "#1A56DB" }}>Share Workliq →</a>
        </p>
      </div>
      <footer style={{ borderTop: "0.5px solid #E5E7EB", padding: "1.5rem 0", fontSize: 12, color: "#9CA3AF" }}>
        © 2026 Workliq Inc. · <a href="/terms" style={{ color: "#9CA3AF" }}>Terms</a> · <a href="/privacy" style={{ color: "#9CA3AF" }}>Privacy</a>
      </footer>
    </main>
  );
}
