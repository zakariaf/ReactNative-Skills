// src/vendored-kit/net.ts: planted (vendored skill content).
export function open(url: string): XMLHttpRequest {
  const request = new XMLHttpRequest();
  request.open('GET', url);
  return request;
}
