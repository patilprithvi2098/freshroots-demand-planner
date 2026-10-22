"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { btn, input } from "@/components/ui";
import { signInAction } from "./actions";

export function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    start(async () => {
      const res = await signInAction({ username, password });
      if (res.ok) {
        router.replace(res.home);
        router.refresh();
      } else {
        setError(res.error);
        setPassword("");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Username</span>
        <input
          name="username"
          required
          maxLength={40}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className={input}
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Password</span>
        <input
          name="password"
          type="password"
          required
          maxLength={200}
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={input}
        />
      </label>
      <div aria-live="polite">
        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </div>
      <button type="submit" disabled={pending} className={`${btn.primary} w-full`}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
