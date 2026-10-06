"use client";

import { useActionState } from "react";
import { login } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const [error, action, pending] = useActionState(login, null);
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <form action={action} className="flex w-full max-w-xs flex-col gap-3">
        <h1 className="text-lg font-semibold">Email automation</h1>
        <Input type="password" name="password" placeholder="Password" aria-label="Password" autoFocus required />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={pending}>
          Sign in
        </Button>
      </form>
    </main>
  );
}
