function ts(): string {
  return new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function info(stage: string, msg: string) {
  console.log(`[${ts()}] ${stage} ${msg}`);
}

export function success(stage: string, msg: string) {
  console.log(`[${ts()}] ✅ ${stage} ${msg}`);
}

export function fail(stage: string, msg: string) {
  console.error(`[${ts()}] ❌ ${stage} ${msg}`);
}

export function warn(stage: string, msg: string) {
  console.error(`[${ts()}] ⚠️  ${stage} ${msg}`);
}

export function banner(
  title: string,
  details: Record<string, string | number>
) {
  const line = "═".repeat(60);
  console.log(`\n${line}`);
  console.log(`  ${title}`);
  console.log(line);
  for (const [k, v] of Object.entries(details)) {
    console.log(`  ${k.padEnd(14)} ${v}`);
  }
  console.log(`${line}\n`);
}
