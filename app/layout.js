import "./globals.css";
import NavBar from "./NavBar";

export const metadata = {
  title: "Survivor Pool",
  description: "NFL Survivor Pool",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <NavBar />
        <main className="max-w-4xl mx-auto px-5 py-6">{children}</main>
      </body>
    </html>
  );
}
