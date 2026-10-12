// Lets phones install the site to the home screen like an app, which iPhones
// require before they'll allow push notifications.
export default function manifest() {
  return {
    name: "Survivor Pool",
    short_name: "Scheuer Pool",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#1F2A35",
    theme_color: "#141B22",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
    ],
  };
}
