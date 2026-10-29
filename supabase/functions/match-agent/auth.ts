/**
 * Service-role access (the eval path): the caller must send exactly the project's service key.
 * Reading the role from the token's payload is not enough, because that payload isn't verified here
 * (it would only be safe while the gateway's JWT check stays on). Pure TypeScript, unit-tested.
 */
export function isServiceKey(token: string, serviceKey: string | undefined): boolean {
  if (!token || !serviceKey || token.length !== serviceKey.length) return false;
  // Constant time: every character is compared whatever the first difference.
  let difference = 0;
  for (let index = 0; index < token.length; index += 1) difference |= token.charCodeAt(index) ^ serviceKey.charCodeAt(index);
  return difference === 0;
}
