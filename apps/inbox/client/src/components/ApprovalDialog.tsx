type ApprovalData = { leadId: number; message: string };

export function ApprovalDialog({ data, onApprove }: { data: ApprovalData; onApprove: () => void }) {
  return (
    <div style={{ border: "1px solid #f0c000", borderRadius: 10, padding: 12, background: "#fffbe6", margin: "8px 0" }}>
      <div style={{ marginBottom: 8 }}>{data.message}</div>
      <button onClick={onApprove} style={{ background: "#0a7", color: "#fff", border: 0, borderRadius: 6, padding: "6px 14px" }}>
        Send
      </button>
    </div>
  );
}
