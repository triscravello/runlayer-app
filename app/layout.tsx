import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/context/authContext";
import RootNavbarGate from "@/components/layout/RootNavbarGate";

export const metadata: Metadata = {
  title: "RunLayer",
  description: "A running appearel and outfit recommendation platform based on real-time weather conditions and personal preferences.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full bg-zinc-50 text-zinc-900 dark:bg-black dark:text-zinc-100">
        <AuthProvider>
          <RootNavbarGate />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
