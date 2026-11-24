import type { Metadata } from "next";
import localFont from "next/font/local";
import { SiteHeader } from "@/components/site-header";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/app-info";
import "./globals.css";

// Noto Sans z plików repozytorium (te same co w PDF; bez pobierania z sieci przy buildzie). Tylko wagi 400 i 700.
const notoSans = localFont({
  variable: "--font-noto-sans",
  display: "swap",
  src: [
    { path: "../lib/export/fonts/NotoSans-Regular.ttf", weight: "400", style: "normal" },
    { path: "../lib/export/fonts/NotoSans-Bold.ttf", weight: "700", style: "normal" },
  ],
});

// Space Grotesk (SIL OFL 1.1, `src/app/fonts/`): tylko nagłówki i tytuł; krój zmienny, waga 300 do 700.
const spaceGrotesk = localFont({
  variable: "--font-grotesk",
  display: "swap",
  src: [{ path: "./fonts/SpaceGrotesk-Variable.ttf", weight: "300 700", style: "normal" }],
});

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: APP_DESCRIPTION,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pl"
      className={`${notoSans.variable} ${spaceGrotesk.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
