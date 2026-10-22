import { redirect } from "next/navigation";
import { getSessionProfile, HOME_BY_ROLE } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getSessionProfile();
  if (session) redirect(HOME_BY_ROLE[session.role]);
  const { error } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <p className="text-sm font-medium text-brand-700">Freshroots</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Demand Planning Assistant</h1>
        <p className="mt-2 text-sm text-neutral-600">Sign in with the email your account was set up with. We will send you a one-time sign-in link.</p>
        {error ? (
          <p role="alert" className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            That sign-in link is invalid or has expired. Request a new one.
          </p>
        ) : null}
        <LoginForm />
      </div>
    </main>
  );
}
