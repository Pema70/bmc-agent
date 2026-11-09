import { z } from "zod";

export const PASSWORD_MIN_LENGTH = 8;
// bcrypt bierze pod uwagę tylko pierwsze 72 bajty hasła.
export const PASSWORD_MAX_LENGTH = 72;

const utf8ByteLength = (value: string): number => new TextEncoder().encode(value).length;

export const EmailInput = z
  .string({ error: "Podaj adres e-mail." })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Podaj poprawny adres e-mail." }).max(254, { error: "Adres e-mail jest za długi." }));

const NewPassword = z
  .string({ error: "Podaj hasło." })
  .min(PASSWORD_MIN_LENGTH, { error: `Hasło musi mieć co najmniej ${PASSWORD_MIN_LENGTH} znaków.` })
  .max(PASSWORD_MAX_LENGTH, { error: `Hasło może mieć najwyżej ${PASSWORD_MAX_LENGTH} znaki.` })
  // Znaki spoza ASCII (np. polskie litery) zajmują w UTF-8 więcej niż 1 bajt.
  .refine((value) => utf8ByteLength(value) <= PASSWORD_MAX_LENGTH, {
    error: "Hasło jest za długie (polskie i inne znaki specjalne liczą się podwójnie).",
  });

export const RegisterInput = z.object({
  email: EmailInput,
  password: NewPassword,
  name: z
    .string()
    .trim()
    .max(100, { error: "Imię może mieć najwyżej 100 znaków." })
    .optional()
    .transform((value) => (value ? value : undefined)),
});
export type RegisterInput = z.infer<typeof RegisterInput>;

export const LoginInput = z.object({
  email: EmailInput,
  password: z
    .string({ error: "Podaj hasło." })
    .min(1, { error: "Podaj hasło." })
    .max(PASSWORD_MAX_LENGTH * 4, { error: "Nieprawidłowe hasło." }),
});
export type LoginInput = z.infer<typeof LoginInput>;
