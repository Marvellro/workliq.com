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

export async function POST(req: Request) {
  try {
    const { name, email, role } = await req.json();

    if (!name || !email) {
      return NextResponse.json(
        { error: "Name and email required" },
        { status: 400 }
      );
    }

    const token = crypto.randomUUID();

    const { error: dbError } = await getSupabase()
      .from("waitlist")
      .upsert({ name, email, role, token, confirmed: false, created_at: new Date().toISOString() });

    if (dbError) {
      console.error("Supabase error:", dbError);
      return NextResponse.json({ error: "Failed to save to waitlist" }, { status: 500 });
    }

    const confirmUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/confirm?token=${token}`;

    await getResend().emails.send({
      from: "Marvellous at Workliq <hello@workliq.com>",
      to: email,
      subject: "Confirm your spot on the Workliq waitlist",
      html: `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f9fafb;font-family:system-ui,sans-serif;"><div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;border:1px solid #e5e7eb;"><div style="background:#0D0F1A;padding:24px 32px;border-radius:12px 12px 0 0;"><span style="color:#F0F2EE;font-size:16px;font-weight:500;">W Workliq</span></div><div style="padding:32px;"><h1 style="font-size:22px;font-weight:500;color:#0D0F1A;margin:0 0 12px;">Hi ${name}, confirm your spot 👋</h1><p style="font-size:15px;color:#374151;line-height:1.7;margin:0 0 24px;">Thanks for joining the Workliq waitlist. Click the button below to confirm your email and lock in your spot.</p><a href="${confirmUrl}" style="display:inline-block;background:#1A56DB;color:#fff;font-size:14px;font-weight:500;padding:12px 28px;border-radius:8px;text-decoration:none;">Confirm my spot →</a><p style="font-size:13px;color:#9CA3AF;margin-top:20px;">Or copy this link: <span style="color:#1A56DB;">${confirmUrl}</span></p></div><div style="padding:16px 32px;border-top:1px solid #E5E7EB;"><p style="font-size:12px;color:#9CA3AF;margin:0;">© 2026 Workliq Inc. · Stockholm, Sweden</p></div></div></body></html>`,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Waitlist error:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
