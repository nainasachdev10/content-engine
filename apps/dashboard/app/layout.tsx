import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Nav from "./nav";
import PwaRegister from "./pwa-register";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Content Engine",
  description: "Your YouTube channel, made for you — review and approve every video before it goes live.",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, title: "Content Engine", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body>
        <div className="shell" style={{ flexDirection: "row", flexWrap: "wrap" }}>
          <Nav />
          <main className="main">{children}</main>
        </div>
        <PwaRegister />
      </body>
    </html>
  );
}
