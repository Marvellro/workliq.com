import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://workliq.com";

  if (!token) return NextResponse.redirect(`${appUrl}/?error=invalid`);

  const supabase = getSupabase();
  const { data: entry, error } = await supabase
    .from("waitlist")
    .select("*")
    .eq("token", token)
    .single();

  if (error || !entry) return NextResponse.redirect(`${appUrl}/?error=notfound`);
  if (entry.confirmed) return NextResponse.redirect(`${appUrl}/confirmed`);

  await supabase
    .from("waitlist")
    .update({ confirmed: true, confirmed_at: new Date().toISOString() })
    .eq("token", token);

  await getResend().emails.send({
    from: "Marvellous at Workliq <hello@workliq.com>",
    to: entry.email,
    subject: "You're on the Workliq waitlist 🎉",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f9fafb;font-family:system-ui,sans-serif;"><div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;border:1px solid #e5e7eb;"><div style="background:#0D0F1A;padding:24px 32px;border-radius:12px 12px 0 0;"><span style="color:#F0F2EE;font-size:16px;font-weight:500;">W Workliq</span></div><div style="padding:32px;"><h1 style="font-size:22px;font-weight:500;color:#0D0F1A;margin:0 0 12px;">You're in, ${entry.name}. 🎉</h1><p style="font-size:15px;color:#374151;line-height:1.7;margin:0 0 16px;">Your spot is confirmed. We'll be in touch within 2 weeks.</p><div style="background:#F9FAFB;border-radius:8px;padding:12px 16px;margin-bottom:12px;"><p style="font-size:14px;font-weight:500;color:#0D0F1A;margin:0 0 4px;">⚡ Connect all your tools in minutes</p><p style="font-size:13px;color:#6B7280;margin:0;">HubSpot, Slack, Gmail, Notion and 200+ more.</p></div><div style="background:#F9FAFB;border-radius:8px;padding:12px 16px;margin-bottom:12px;"><p style="font-size:14px;font-weight:500;color:#0D0F1A;margin:0 0 4px;">🤖 AI agents that run 24/7</p><p style="font-size:13px;color:#6B7280;margin:0;">Enrich leads, triage tickets, generate reports automatically.</p></div></div><div style="padding:24px 32px;border-top:1px solid #E5E7EB;"><p style="font-size:14px;color:#374151;line-height:1.7;margin:0 0 12px;">I'm Marvellous, founder of Workliq. Reply to this email anytime — I read every one.</p><p style="font-size:14px;font-weight:500;color:#0D0F1A;margin:0;">Marvellous Junior Okorie</p><p style="font-size:13px;color:#9CA3AF;margin:0;">Founder & CEO, Workliq</p></div><div style="padding:16px 32px;border-top:1px solid #E5E7EB;"><p style="font-size:12px;color:#9CA3AF;margin:0;">© 2026 Workliq Inc. · Stockholm, Sweden</p></div></div></body></html>`,
  });

  return NextResponse.redirect(`${appUrl}/confirmed`);
}
