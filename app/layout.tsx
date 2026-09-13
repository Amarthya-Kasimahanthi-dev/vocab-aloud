import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vocab Aloud — a voice tutor for vocabulary",
  description:
    "Hear a word, say what it means, get spoken feedback. Runs in the browser with no speech API keys.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* Loaded at runtime rather than through next/font so the build
            never needs network access. System serif/sans fall back cleanly. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&family=Inter:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
