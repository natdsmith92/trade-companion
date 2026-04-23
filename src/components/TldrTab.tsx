"use client";

import { useState, useEffect } from "react";
import { TldrData } from "@/lib/tldr-types";

interface Props {
  sessionDate: string;
}

const COLOR_MAP: Record<string, string> = {
  bull: "var(--bull)",
  bear: "var(--bear)",
  gold: "var(--gold)",
  blue: "var(--blue)",
};

export default function TldrTab({ sessionDate }: Props) {
  const [data, setData] = useState<TldrData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionDate) return;

    setLoading(true);
    setError(null);
    setData(null);

    fetch(`/api/tldr?date=${sessionDate}`)
      .then((r) => {
        if (r.status === 404) {
          setError("No plan found for this date.");
          return null;
        }
        if (r.status === 503) {
          setError("TL;DR generation failed — try again later.");
          return null;
        }
        if (!r.ok) throw new Error("Fetch failed");
        return r.json();
      })
      .then((json) => {
        if (json && json.stats) setData(json);
      })
      .catch(() => setError("Failed to load TL;DR."))
      .finally(() => setLoading(false));
  }, [sessionDate]);

  if (!sessionDate) {
    return (
      <div className="empty-card">
        No session selected.
      </div>
    );
  }

  if (loading) return <Skeleton />;

  if (error) {
    return (
      <div className="empty-card">
        {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="empty-card">
        Paste a Mancini email to generate a TL;DR for the day.
      </div>
    );
  }

  return (
    <div>
      {/* Stats row */}
      <div className="tldr-stat-row">
        {data.stats.map((stat, i) => (
          <div key={i} className="tldr-stat">
            <div className="tldr-stat-label">{stat.label}</div>
            <div
              className="tldr-stat-val"
              style={{ color: COLOR_MAP[stat.color] || "var(--t1)" }}
            >
              {stat.value}
            </div>
            <div className="tldr-stat-sub">{stat.subtitle}</div>
          </div>
        ))}
      </div>

      {/* Sections */}
      {data.sections.map((section, si) => (
        <div key={si} className="tldr-section">
          <div
            className="tldr-section-title"
            style={{ color: COLOR_MAP[section.color] || "var(--t1)" }}
          >
            {section.icon} {section.title}
          </div>
          {section.insights.map((insight, ii) => (
            <div key={ii} className="tldr-insight">
              <div className={`tldr-tag ${insight.tagType}`}>{insight.tag}</div>
              <div
                className="tldr-insight-text"
                dangerouslySetInnerHTML={{ __html: insight.text }}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* Loading skeleton */
function Skeleton() {
  return (
    <div className="tldr-skeleton">
      {/* 3 stat card placeholders */}
      <div className="tldr-stat-row">
        {[0, 1, 2].map((i) => (
          <div key={i} className="tldr-stat skel">
            <div className="skel-line skel-short" />
            <div className="skel-line skel-big" />
            <div className="skel-line skel-short" />
          </div>
        ))}
      </div>

      {/* 4 section placeholders */}
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="tldr-section">
          <div className="skel-line skel-title" />
          <div className="tldr-insight skel">
            <div className="skel-line skel-tag" />
            <div className="skel-line skel-text" />
            <div className="skel-line skel-text skel-text-short" />
          </div>
          <div className="tldr-insight skel">
            <div className="skel-line skel-tag" />
            <div className="skel-line skel-text" />
          </div>
        </div>
      ))}
    </div>
  );
}
