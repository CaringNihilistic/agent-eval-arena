import type { Metadata } from "next";
import { Josefin_Sans, Libre_Baskerville, Limelight } from "next/font/google";

import { Providers } from "@/components/providers";
import { SiteFooter, SiteHeader } from "@/components/site-header";

import "./globals.css";

const limelight = Limelight({ variable: "--font-limelight", weight: "400", subsets: ["latin"] });
const baskerville = Libre_Baskerville({
  variable: "--font-baskerville",
  weight: ["400", "700"],
  style: ["normal", "italic"],
  subsets: ["latin"],
});
const josefin = Josefin_Sans({ variable: "--font-josefin", weight: "600", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Poison Pen: A Wrenfield Hall Mystery",
  description:
    "A blind test of three AI models, played as a country-house mystery. Read two unsigned answers to the same task, say which is better, then see which Claude model wrote each.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${limelight.variable} ${baskerville.variable} ${josefin.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <Providers>
          <SiteHeader />
          <div className="flex flex-1 flex-col">{children}</div>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
