import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "قص فيديو يوتيوب | Slice YouTube Video",
  description: "قص جزء محدد من أي فيديو يوتيوب وحفظه مباشرة على جهازك",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-screen antialiased selection:bg-red-500/30">
        {children}
      </body>
    </html>
  );
}
