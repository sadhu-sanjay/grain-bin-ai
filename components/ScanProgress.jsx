"use client";

// Turns one raw progress event from route.js's ndjson stream into a
// human-readable status line. `clusterCount` (from the "clustering" event)
// lets candidate events show "3 of 12" instead of just "3".
function describeEvent(event, clusterCount) {
  switch (event.stage) {
    case "buildings":
      return event.status === "start"
        ? "Loading building footprints…"
        : `Found ${event.count} buildings`;
    case "clustering":
      return `Grouped into ${event.count} farmstead candidates`;
    case "candidate": {
      const of = clusterCount ? ` of ${clusterCount}` : "";
      switch (event.status) {
        case "chip-start":
          return `Candidate ${event.index}${of}: fetching aerial imagery…`;
        case "chip-done":
          return `Candidate ${event.index}${of}: imagery ready`;
        case "roboflow-start":
          return `Candidate ${event.index}${of}: checking for bins…`;
        case "roboflow-done":
          return event.found
            ? `Candidate ${event.index}${of}: bin detected`
            : `Candidate ${event.index}${of}: nothing found`;
        default:
          return `Candidate ${event.index}${of}…`;
      }
    }
    default:
      return null;
  }
}

export default function ScanProgress({ events, binsFound = 0 }) {
  if (!events || events.length === 0) return null;

  const clusterEvent = events.find((e) => e.stage === "clustering");
  const clusterCount = clusterEvent?.count ?? null;

  const candidateEvents = events.filter((e) => e.stage === "candidate");
  const lastCandidateIndex = candidateEvents.length
    ? candidateEvents[candidateEvents.length - 1].index
    : 0;

  const last = events[events.length - 1];
  const currentLine = describeEvent(last, clusterCount);
  if (!currentLine) return null;

  return (
    <div className="scan-progress-panel" style={styles.panel}>
      <style>{`
        @keyframes scan-progress-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.35; transform: scale(1.4); }
        }
      `}</style>
      <div style={styles.headerRow}>
        <span style={styles.dot} />
        <span style={styles.line}>{currentLine}</span>
      </div>
      <div style={styles.metaRow}>
        {clusterCount != null && (
          <span>
            Candidate {Math.min(lastCandidateIndex, clusterCount)} of{" "}
            {clusterCount}
          </span>
        )}
        <span>
          {binsFound} bin{binsFound === 1 ? "" : "s"} found so far
        </span>
      </div>
    </div>
  );
}

const styles = {
  panel: {
    position: "absolute",
    bottom: 20,
    left: "50%",
    transform: "translateX(-50%)",
    background: "rgba(20,20,18,0.88)",
    color: "#f4efe3",
    padding: "10px 16px",
    borderRadius: 10,
    fontSize: 13,
    display: "flex",
    flexDirection: "column",
    gap: 4,
    zIndex: 20,
    minWidth: 260,
    boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
    pointerEvents: "none",
  },
  headerRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "#c9a227",
    animation: "scan-progress-pulse 1s ease-in-out infinite",
    flexShrink: 0,
  },
  line: {
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  metaRow: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 11,
    opacity: 0.75,
  },
};
