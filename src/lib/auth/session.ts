import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authOptions } from "@/lib/auth/options";

// Jedyne miejsce, w którym kod serwerowy czyta sesję. Migracja na Auth.js v5
// sprowadzi się do podmiany getServerSession(authOptions) na auth().

export const AppSession = z.object({
  user: z.object({
    id: z.string().min(1),
    email: z.email(),
    name: z.string().nullable(),
  }),
});
export type AppSession = z.infer<typeof AppSession>;

export async function getSession(): Promise<AppSession | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return null;
  }

  const parsed = AppSession.safeParse({
    user: { id: session.user.id, email: session.user.email, name: session.user.name ?? null },
  });
  return parsed.success ? parsed.data : null;
}

export async function requireSession(): Promise<AppSession> {
  const session = await getSession();
  if (!session) {
    redirect("/logowanie");
  }
  return session;
}
