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

export interface TldrData {
  stats: TldrStat[];
  sections: TldrSection[];
}
