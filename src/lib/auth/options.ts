import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { authorizeCredentials } from "@/lib/auth/authorize";

// Konfiguracja next-auth v4. Poza tym plikiem i route handlerem /api/auth
// kod serwerowy nie importuje next-auth: sesję czyta tylko getSession() (src/lib/auth/session.ts).
export const authOptions: NextAuthOptions = {
  // Provider Credentials w v4 działa tylko z sesją JWT (bez tabel Session/Account).
  session: { strategy: "jwt" },
  secret: process.env.AUTH_SECRET,
  pages: { signIn: "/logowanie" },
  providers: [
    CredentialsProvider({
      name: "E-mail i hasło",
      credentials: {
        email: { label: "E-mail", type: "email" },
        password: { label: "Hasło", type: "password" },
      },
      authorize: (credentials) => authorizeCredentials(credentials),
    }),
  ],
  callbacks: {
    session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
};
