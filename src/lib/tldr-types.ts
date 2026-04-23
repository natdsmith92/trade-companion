export interface TldrStat {
  label: string;
  value: string;
  color: "bull" | "bear" | "gold" | "blue";
  subtitle: string;
}

export interface TldrInsight {
  tag: string;
  tagType: "caution" | "opportunity" | "context" | "key";
  text: string; // HTML string with <strong> and <span class="num">
}

export interface TldrSection {
  title: string;
  icon: string;
  color: "bear" | "bull" | "gold" | "blue";
  insights: TldrInsight[];
}

export interface FbSetup {
  level: number;
  quality: "A+" | "A" | "B" | "Watch";
  action: string;   // HTML string — concise action instruction
  context: string;  // HTML string — why this level matters
  invalidation: string; // what kills the setup
}

export interface TldrData {
  stats: TldrStat[];
  sections: TldrSection[];
  fbSetups?: FbSetup[];
}
