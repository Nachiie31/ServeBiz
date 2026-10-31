import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/login"],
        // Private, logged-in areas and APIs should never be crawled.
        disallow: [
          "/api/", "/auth/", "/dashboard", "/pos", "/inventory", "/sales", "/reports", "/team",
          "/settings", "/audit", "/businesses", "/overview", "/invitations", "/onboarding",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
