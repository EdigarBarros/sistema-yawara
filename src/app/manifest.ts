import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Central Yawara",
    short_name: "Yawara",
    description: "Plataforma interna da Atlética Yawara de Psicologia",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#041046",
    theme_color: "#030820",
    lang: "pt-BR",
    icons: [
      { src: "/app/icone-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/app/icone-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/app/icone-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
