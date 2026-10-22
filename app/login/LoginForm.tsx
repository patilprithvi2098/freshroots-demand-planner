"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { btn, input } from "@/components/ui";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const supabase = createClient();
    const site = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin;
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      // Accounts are created by an administrator; the login screen never creates users.
      options: { shouldCreateUser: false, emailRedirectTo: `${site}/auth/callback` },
    });
    if (error) {
      setState("error");
      setMessage(
        error.message.toLowerCase().includes("signups not allowed") || error.status === 422
          ? "No account exists for that email. Ask your administrator to add you."
          : error.message,
      );
      return;
    }
    setState("sent");
  }

  if (state === "sent") {
    return (
      <p role="status" className="mt-6 rounded-md border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-800">
        Check <strong>{email}</strong> for a sign-in link. It expires in one hour.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-3">
      <label htmlFor="email" className="block text-sm font-medium">
        Work email
      </label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className={input}
      />
      {state === "error" ? (
        <p role="alert" className="text-sm text-red-700">
          {message}
        </p>
      ) : null}
      <button type="submit" disabled={state === "sending"} className={`${btn.primary} w-full`}>
        {state === "sending" ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
