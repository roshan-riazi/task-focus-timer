import type { Metadata } from "next";
import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = { title: "Create account — FocusFlow" };

export default function RegisterPage() {
  return (
    <section aria-labelledby="register-heading">
      <h1 id="register-heading" className="text-2xl font-semibold tracking-tight">
        Create your account
      </h1>
      <p className="mt-2 max-w-prose text-sm opacity-80">
        One account, one workspace. You can use the app right away — email
        verification just removes a reminder banner.
      </p>
      <div className="mt-6">
        <RegisterForm />
      </div>
    </section>
  );
}
