import "./globals.css";
import NavBar from "./NavBar";
import NoticeBanner from "./NoticeBanner";

export const metadata = {
  title: "Survivor Pool",
  description: "NFL Survivor Pool",
  // Opens full-screen (no Safari bars) when launched from the iPhone home screen.
  appleWebApp: { capable: true, title: "Scheuer Pool", statusBarStyle: "black" },
  icons: { apple: "/apple-touch-icon.png" },
};

export const viewport = {
  themeColor: "#141B22",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <NavBar />
        <main className="max-w-4xl mx-auto px-5 py-6">
          <NoticeBanner />
          {children}
        </main>
      </body>
    </html>
  );
}
