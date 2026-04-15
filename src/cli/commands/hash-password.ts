import bcrypt from "bcrypt";

export async function runHashPassword(password: string): Promise<void> {
  if (!password) {
    process.stderr.write("usage: mcpaudit hash-password <password>\n");
    process.exitCode = 2;
    return;
  }
  const hash = await bcrypt.hash(password, 10);
  process.stdout.write(hash + "\n");
}
