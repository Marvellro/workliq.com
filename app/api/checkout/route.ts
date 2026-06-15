import { NextResponse } from "next/server";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-05-27.dahlia",
});

const PRICE_IDS: Record<string, Record<string, string>> = {
  starter: {
    monthly: process.env.STRIPE_PRICE_STARTER_MONTHLY!,
    annual: process.env.STRIPE_PRICE_STARTER_ANNUAL!,
  },
  growth: {
    monthly: process.env.STRIPE_PRICE_GROWTH_MONTHLY!,
    annual: process.env.STRIPE_PRICE_GROWTH_ANNUAL!,
  },
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { plan, billing, email } = body as {
      plan: "starter" | "growth";
      billing: "monthly" | "annual";
      email: string;
    };

    if (!plan || !billing || !email) {
      return NextResponse.json(
        { error: "plan, billing, and email are required" },
        { status: 400 }
      );
    }

    if (!["starter", "growth"].includes(plan)) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    if (!["monthly", "annual"].includes(billing)) {
      return NextResponse.json({ error: "Invalid billing period" }, { status: 400 });
    }

    const priceId = PRICE_IDS[plan]?.[billing];
    if (!priceId) {
      return NextResponse.json({ error: "Price not configured" }, { status: 500 });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `https://workliq.com/onboarding?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://workliq.com/pricing`,
      allow_promotion_codes: true,
      subscription_data: {
        metadata: { plan, billing },
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("Stripe checkout error:", err);
    return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
  }
}
