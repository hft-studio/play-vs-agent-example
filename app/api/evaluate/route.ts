import { handEvalEnabled } from "@/lib/flags";
import { proxyPlay } from "../_proxy";

export const runtime = "nodejs";
export const maxDuration = 120;

function off() {
  return Response.json({ error: "hand evaluation is off" }, { status: 404 });
}

export function GET() {
  if (!handEvalEnabled) return off();
  return proxyPlay("GET", "/api/play/evaluate");
}

export function POST(req: Request) {
  if (!handEvalEnabled) return off();
  return proxyPlay("POST", "/api/play/evaluate", req);
}
