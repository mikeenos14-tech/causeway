// Save percentage the way hockey writes it: ".915", and "1.000" for a
// perfect game. Accepts a number or the numeric string Postgres returns.
export function formatSavePct(v: number | string | null | undefined): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(3).replace(/^0(?=\.)/, "");
}
