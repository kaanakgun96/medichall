/**
 * Synthetic capacity fixtures for Universal High-Recall Buyer Discovery V2.
 *
 * Product labels are deliberately confined to this test-only module. Runtime
 * classification uses the same generic evidence/tier rules for every fixture;
 * no benchmark product has a special scoring branch here or in production.
 */

export type HighRecallBenchmarkProfile = "BROAD" | "STANDARD" | "NICHE";

export type HighRecallBenchmarkFixture = {
  key: string;
  product: string;
  slug: string;
  aliases: string[];
  categoryTerm: string;
  profile: HighRecallBenchmarkProfile;
  rawObservations: number;
  tiers: {
    strong: number;
    likely: number;
    potential: number;
    lowConfidence: number;
    hardReject: number;
  };
};

export const HIGH_RECALL_BENCHMARK_FIXTURES: HighRecallBenchmarkFixture[] = [
  {
    key: "surgical-gown",
    product: "Sterile Surgical Gown",
    slug: "sterile-surgical-gown",
    aliases: ["surgical gown"],
    categoryTerm: "operating room infection prevention apparel",
    profile: "BROAD",
    rawObservations: 120,
    tiers: {
      strong: 16,
      likely: 24,
      potential: 28,
      lowConfidence: 10,
      hardReject: 8,
    },
  },
  {
    key: "medical-glove",
    product: "Medical Examination Glove",
    slug: "medical-examination-glove",
    aliases: ["clinical examination glove"],
    categoryTerm: "clinical hand protection consumables",
    profile: "BROAD",
    rawObservations: 130,
    tiers: {
      strong: 18,
      likely: 24,
      potential: 30,
      lowConfidence: 10,
      hardReject: 8,
    },
  },
  {
    key: "biopsy-needle",
    product: "Biopsy Needle",
    slug: "biopsy-needle",
    aliases: ["tissue sampling needle"],
    categoryTerm: "interventional tissue sampling devices",
    profile: "STANDARD",
    rawObservations: 78,
    tiers: {
      strong: 9,
      likely: 13,
      potential: 15,
      lowConfidence: 8,
      hardReject: 7,
    },
  },
  {
    key: "trocar",
    product: "Laparoscopy Trocar",
    slug: "laparoscopy-trocar",
    aliases: ["laparoscopic trocar"],
    categoryTerm: "minimally invasive surgical access devices",
    profile: "STANDARD",
    rawObservations: 100,
    tiers: {
      strong: 12,
      likely: 17,
      potential: 21,
      lowConfidence: 8,
      hardReject: 7,
    },
  },
  {
    key: "camera-cover",
    product: "Camera Cover",
    slug: "camera-cover",
    aliases: ["sterile camera sleeve"],
    categoryTerm: "operating room barrier products",
    profile: "NICHE",
    rawObservations: 75,
    tiers: {
      strong: 8,
      likely: 12,
      potential: 15,
      lowConfidence: 7,
      hardReject: 6,
    },
  },
  {
    key: "general-procedure-pack",
    product: "General Procedure Pack",
    slug: "general-procedure-pack",
    aliases: ["custom procedure pack"],
    categoryTerm: "preconfigured operating room consumable kits",
    profile: "BROAD",
    rawObservations: 115,
    tiers: {
      strong: 15,
      likely: 23,
      potential: 25,
      lowConfidence: 10,
      hardReject: 8,
    },
  },
  {
    key: "ct-injector",
    product: "CT Contrast Injector",
    slug: "ct-contrast-injector",
    aliases: ["contrast media injection system"],
    categoryTerm: "diagnostic imaging contrast delivery equipment",
    profile: "NICHE",
    rawObservations: 65,
    tiers: {
      strong: 7,
      likely: 10,
      potential: 12,
      lowConfidence: 7,
      hardReject: 6,
    },
  },
  {
    key: "ecg-electrode",
    product: "ECG Electrode",
    slug: "ecg-electrode",
    aliases: ["electrocardiography electrode"],
    categoryTerm: "cardiac patient monitoring consumables",
    profile: "STANDARD",
    rawObservations: 105,
    tiers: {
      strong: 14,
      likely: 19,
      potential: 23,
      lowConfidence: 9,
      hardReject: 7,
    },
  },
  {
    key: "patient-warming-blanket",
    product: "Patient Warming Blanket",
    slug: "patient-warming-blanket",
    aliases: ["patient heating blanket"],
    categoryTerm: "perioperative temperature management",
    profile: "STANDARD",
    rawObservations: 100,
    tiers: {
      strong: 12,
      likely: 18,
      potential: 22,
      lowConfidence: 9,
      hardReject: 7,
    },
  },
  {
    key: "unseen-cstd",
    product: "Closed System Drug Transfer Device",
    slug: "closed-system-drug-transfer-device",
    aliases: [],
    categoryTerm: "hazardous drug containment systems",
    profile: "NICHE",
    rawObservations: 61,
    tiers: {
      strong: 6,
      likely: 9,
      potential: 11,
      lowConfidence: 7,
      hardReject: 6,
    },
  },
];
