"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/" })}
      className="rounded-lg border border-border px-3 py-1 text-sm hover:bg-tint"
    >
      Wyloguj
    </button>
  );
}
