/** Read a required environment variable, throwing a clear error if it's unset. */
export function need(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}
