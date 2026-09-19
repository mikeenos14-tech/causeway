import { answerQuestion } from "../lib/qa-engine";

async function main() {
  const question = process.argv.slice(2).join(" ");
  if (!question) throw new Error("Usage: tsx scripts/test-qa-engine.ts <question>");

  console.log(`Q: ${question}\n`);
  const result = await answerQuestion(question);
  console.log(`Queries run (${result.queries.length}):`);
  for (const q of result.queries) console.log(`  ${q.sql}${q.error ? ` [ERROR: ${q.error}]` : ` (${q.rows?.length ?? 0} rows)`}`);
  console.log(`\nA: ${result.answer}`);
  if (result.table) {
    console.log(`\nTABLE (${result.table.rows.length} rows, columns: ${result.table.columns.join(", ")})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
