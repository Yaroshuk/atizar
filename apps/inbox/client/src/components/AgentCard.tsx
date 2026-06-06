export type Status =
  | "idle"
  | "running"
  | "awaiting_approval"
  | "done"
  | "error";

const LABEL: Record<Status, string> = {
  idle: "Idle",
  running: "Working…",
  awaiting_approval: "Awaiting approval",
  done: "Done",
  error: "Error",
};
const DOT: Record<Status, string> = {
  idle: "#bbb",
  running: "#0a7",
  awaiting_approval: "#f0c000",
  done: "#0a7",
  error: "#e33",
};

export function AgentCard({
  name,
  status,
  onStart,
  onOpen,
}: {
  name: string;
  status: Status;
  onStart: () => void;
  onOpen: () => void;
}) {
  return (
    <div
      onClick={onOpen}
      style={{
        width: 280,
        border: "1px solid #ddd",
        borderRadius: 12,
        padding: 16,
        background: "#fff",
        cursor: "pointer",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <strong>{name}</strong>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: "#666",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 8,
              background: DOT[status],
            }}
          />
          {LABEL[status]}
        </span>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onStart();
        }}
        style={{
          marginTop: 12,
          padding: "6px 16px",
          borderRadius: 6,
          border: 0,
          background: "#111",
          color: "#fff",
        }}
      >
        START
      </button>
    </div>
  );
}
