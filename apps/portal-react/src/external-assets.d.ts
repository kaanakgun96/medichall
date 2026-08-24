declare module "*medichall-navigation.js";
declare module "*medichall-traffic.js";
declare module "*external-prospects.js";

type BuyerDiscoveryProfile = {
  role?: string;
  target_countries?: string[];
};

type BuyerDiscoveryWorkspace = {
  load(): Promise<void>;
  render(): void;
  destroy(): void;
};

declare global {
  var MedicHallExternalProspects: {
    createWorkspace(options: {
      root: HTMLElement;
      companyId: number;
      rpc(name: string, parameters: Record<string, unknown>): Promise<unknown>;
      edge(name: string, body: Record<string, unknown>): Promise<unknown>;
      profile: BuyerDiscoveryProfile;
      activeProductCount: number;
      targetCountries: string[];
      productProfileUrl?: string;
      openProductDraft?(suggestion: Record<string, unknown>): void;
      toast(message: string): void;
      track(event: string): void;
    }): BuyerDiscoveryWorkspace;
  };
  var MedicHallTraffic: {
    trackConversion?(event: string): void;
  } | undefined;
}

export {};
