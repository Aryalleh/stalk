/** Split a migration file into statements (our files have no ';' inside strings or comments). */
export function statements(sql: string) {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, "").trimEnd())
    .join("\n")
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}
