import { NextResponse } from "next/server";
import { Resend } from "resend";
import { getSupabaseAdmin, appUrl } from "@/lib/config";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { clientIp } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { normaliseEmail, cleanText, confirmHeading } from "@/lib/waitlist";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);

    // The email-only form at the bottom of the page sends no name, and used to
    // be rejected here for it — while the form showed "you're on the list".
    // A name is optional; a valid address is not.
    const email = normaliseEmail(body?.email);
    if (!email) {
      return NextResponse.json(
        { error: "Please enter a valid email address." },
        { status: 400 }
      );
    }
    const name = cleanText(body?.name);
    const role = cleanText(body?.role) || null;

    // Every call to this endpoint sends an email through Resend. Unthrottled,
    // it is an open relay: anyone can make Workliq send mail to any address,
    // which burns the sending domain's reputation and gets hello@workliq.com
    // blacklisted. Limit by IP (the submitter) and by target address (so one
    // victim cannot be mail-bombed from many sources).
    const ip = clientIp(req);
    const [ipLimit, emailLimit] = await Promise.all([
      checkRateLimit(`waitlist:ip:${ip ?? "unknown"}`, RATE_LIMITS.waitlist),
      checkRateLimit(`waitlist:email:${email}`, RATE_LIMITS.waitlist),
    ]);
    if (!ipLimit.allowed || !emailLimit.allowed) {
      return rateLimitResponse(ipLimit.allowed ? emailLimit : ipLimit);
    }

    const supabase = getSupabaseAdmin();

    // One entry per address — the table is unique on it. This used to be an
    // upsert with no conflict target, which made it a plain insert: a second
    // signup from the same address failed with "Failed to save", so someone
    // whose confirmation never arrived could not ask for it again.
    const { data: existing, error: readError } = await supabase
      .from("waitlist")
      .select("id, name, token, confirmed")
      .eq("email", email)
      .maybeSingle();

    if (readError) {
      console.error("Waitlist lookup failed:", readError);
      return NextResponse.json({ error: "Failed to save to waitlist" }, { status: 500 });
    }

    if (existing?.confirmed) {
      // Already on the list, so there is nothing to confirm and no email to
      // send. The answer is the same as for a new signup on purpose: a
      // different one would let anyone test whether an address is on the list.
      return NextResponse.json({ success: true });
    }

    let token: string;
    if (existing) {
      // Signed up before but never confirmed — the email may have been
      // refused, lost, or filtered. Send it again for the same entry: the same
      // token, so an earlier link still works; the same place in the queue;
      // and a name given before is kept rather than blanked by the email-only
      // form.
      token = existing.token;
      const changes: Record<string, string> = {};
      if (name && name !== existing.name) changes.name = name;
      if (role) changes.role = role;
      if (Object.keys(changes).length > 0) {
        const { error: updateError } = await supabase.from("waitlist").update(changes).eq("id", existing.id);
        if (updateError) console.error("Waitlist update failed:", updateError);
      }
    } else {
      token = crypto.randomUUID();
      const { error: insertError } = await supabase
        .from("waitlist")
        .insert({ name, email, role, token, confirmed: false });

      if (insertError) {
        console.error("Waitlist insert failed:", insertError);
        return NextResponse.json({ error: "Failed to save to waitlist" }, { status: 500 });
      }
    }

    const confirmUrl = appUrl(`/api/confirm?token=${token}`);

    // sendEmail throws when Resend refuses the email; the SDK on its own does
    // not, and this route used to answer success while the person waited for a
    // confirmation that was never sent. They can retry: a second signup from
    // the same unconfirmed address sends this email again (see above).
    try {
      await sendEmail(getResend(), {
        from: "Marvellous at Workliq <hello@workliq.com>",
        to: email,
        subject: "Confirm your spot on the Workliq waitlist",
        html: `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f9fafb;font-family:system-ui,sans-serif;"><div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;border:1px solid #e5e7eb;"><div style="background:#0D0F1A;padding:24px 32px;border-radius:12px 12px 0 0;"><span style="color:#F0F2EE;font-size:16px;font-weight:500;">W Workliq</span></div><div style="padding:32px;"><h1 style="font-size:22px;font-weight:500;color:#0D0F1A;margin:0 0 12px;">${confirmHeading(name)}</h1><p style="font-size:15px;color:#374151;line-height:1.7;margin:0 0 24px;">Thanks for joining the Workliq waitlist. Click the button below to confirm your email and lock in your spot.</p><a href="${confirmUrl}" style="display:inline-block;background:#1A56DB;color:#fff;font-size:14px;font-weight:500;padding:12px 28px;border-radius:8px;text-decoration:none;">Confirm my spot →</a><p style="font-size:13px;color:#9CA3AF;margin-top:20px;">Or copy this link: <span style="color:#1A56DB;">${confirmUrl}</span></p></div><div style="padding:16px 32px;border-top:1px solid #E5E7EB;"><p style="font-size:12px;color:#9CA3AF;margin:0;">© 2026 Workliq Inc. · Stockholm, Sweden</p></div></div></body></html>`,
      });
    } catch (err) {
      console.error("Waitlist confirmation email was not sent:", err);
      return NextResponse.json(
        { error: "We saved your spot but couldn't send the confirmation email. Please try again in a few minutes." },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Waitlist error:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
