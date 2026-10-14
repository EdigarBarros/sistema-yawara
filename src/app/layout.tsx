import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Providers } from "@/components/providers";
import { THEME_BOOT_SCRIPT } from "@/stores/ui";
import "./globals.css";

const inter = localFont({
  src: "./fonts/Inter-400-700.woff2",
  weight: "400 700",
  variable: "--font-inter",
  display: "swap",
});

const barlow = localFont({
  src: [
    { path: "./fonts/BarlowSemiCondensed-500.woff2", weight: "500" },
    { path: "./fonts/BarlowSemiCondensed-600.woff2", weight: "600" },
    { path: "./fonts/BarlowSemiCondensed-700.woff2", weight: "700" },
  ],
  variable: "--font-barlow",
  display: "swap",
});

const jetbrains = localFont({
  src: "./fonts/JetBrainsMono-400-600.woff2",
  weight: "400 600",
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Central Yawara", template: "%s · Central Yawara" },
  description: "Plataforma interna de gestão da Associação Atlética Acadêmica de Psicologia Yawara — versão de demonstração.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#030820",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" data-theme="dark" suppressHydrationWarning className={`${inter.variable} ${barlow.variable} ${jetbrains.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
