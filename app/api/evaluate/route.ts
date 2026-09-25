import { proxyPlay } from "../_proxy";

export const runtime = "nodejs";
export const maxDuration = 120;

export function GET() {
  return proxyPlay("GET", "/api/play/evaluate");
}

export function POST(req: Request) {
  return proxyPlay("POST", "/api/play/evaluate", req);
}
