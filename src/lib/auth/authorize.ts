import { prisma } from "@/lib/db/client";
import { verifyPassword } from "@/lib/auth/password";
import { LoginInput } from "@/lib/schemas/auth";

export type AuthorizedUser = { id: string; email: string; name: string | null };

// Hash nieistniejącego hasła: porównanie przy nieznanym e-mailu trwa tyle samo,
// więc czas odpowiedzi nie zdradza, czy konto istnieje.
const DUMMY_HASH = "$2b$12$GSDBoqToofN0mYgdzecztONvm/vcHDRm5SmOr4ZZz2FD27cYUwn/q";

export async function authorizeCredentials(credentials: unknown): Promise<AuthorizedUser | null> {
  const parsed = LoginInput.safeParse(credentials);
  if (!parsed.success) {
    return null;
  }

  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, passwordHash: true },
  });

  const passwordOk = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !passwordOk) {
    return null;
  }

  return { id: user.id, email: user.email, name: user.name };
}
