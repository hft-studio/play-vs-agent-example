/** True when this deployment has a Studio token. The value itself stays server-side. */
export function GET() {
  return Response.json({ ready: Boolean(process.env.PLAY_API_TOKEN) });
}
