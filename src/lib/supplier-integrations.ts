import "server-only";

import type { SupplierId } from "@/lib/pilot-data";

export type SupplierConnectionStage = "application_required" | "credentials_required" | "configuration_ready";

export type SupplierIntegration = {
  id: SupplierId;
  name: string;
  programName: string;
  stage: SupplierConnectionStage;
  statusLabel: string;
  description: string;
  applicationUrl: string;
  applicationLabel: string;
  capabilities: string[];
  missingConfiguration: string[];
  caveat: string;
};

function missingEnvironmentVariables(names: string[]) {
  return names.filter((name) => !process.env[name]?.trim());
}

export function getSupplierIntegrations(): SupplierIntegration[] {
  const lowesRequired = [
    "LOWES_PRODUCT_DISCOVERY_CLIENT_ID",
    "LOWES_PRODUCT_DISCOVERY_CLIENT_SECRET",
    "LOWES_PRODUCT_DISCOVERY_API_URL",
  ];
  const homeDepotRequired = [
    "HOME_DEPOT_PRODUCT_FEED_URL",
    "HOME_DEPOT_IMPACT_PID",
  ];
  const lowesMissing = missingEnvironmentVariables(lowesRequired);
  const homeDepotMissing = missingEnvironmentVariables(homeDepotRequired);

  return [
    {
      id: "lowes",
      name: "Lowe’s",
      programName: "Product Discovery",
      stage: lowesMissing.length === 0 ? "configuration_ready" : "application_required",
      statusLabel: lowesMissing.length === 0 ? "Credentials added" : "Partner approval needed",
      description: "Official partner access for a daily product catalog plus current store-level price, availability, and promotions.",
      applicationUrl: "https://developer.lowes.com/portal/solutions/product-discovery/",
      applicationLabel: "Apply through Lowe’s Developer Hub",
      capabilities: ["Product catalog", "Local price", "Real-time availability", "Current promotions"],
      missingConfiguration: lowesMissing,
      caveat: "The final endpoint and response mapping are supplied during Lowe’s partner onboarding. Until approval, Volteira opens the retailer’s live product results.",
    },
    {
      id: "home-depot",
      name: "The Home Depot",
      programName: "Affiliate product feed",
      stage: homeDepotMissing.length === 0 ? "configuration_ready" : "application_required",
      statusLabel: homeDepotMissing.length === 0 ? "Feed configuration added" : "Affiliate approval needed",
      description: "Home Depot’s public partner path provides a daily product data feed and retailer-managed tracking links through Impact.",
      applicationUrl: "https://www.homedepot.com/c/SF_MS_The_Home_Depot_Affiliate_Program",
      applicationLabel: "Apply to The Home Depot Affiliate Program",
      capabilities: ["Daily product feed", "Product links", "Affiliate tracking", "Online product pricing"],
      missingConfiguration: homeDepotMissing,
      caveat: "The affiliate feed is not a documented real-time store inventory API. Volteira keeps local stock claims on Home Depot’s live product page unless a separate partner agreement supplies inventory access.",
    },
  ];
}
