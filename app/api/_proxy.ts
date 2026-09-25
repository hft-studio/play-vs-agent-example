const UPSTREAM = (process.env.PLAY_API_BASE ?? "https://www.pokerstudy.ai").replace(/\/+$/, "");

export async function proxyPlay(method: "GET" | "POST", path: string, req?: Request) {
  const headers: Record<string, string> = { Accept: "application/json" };
  const incoming = req?.headers.get("authorization");
  const envToken = process.env.PLAY_API_TOKEN;
  if (incoming) headers.Authorization = incoming;
  else if (envToken) headers.Authorization = `Bearer ${envToken}`;
  else if (method === "POST") {
    return Response.json({ error: "authentication required" }, { status: 401 });
  }

  let body: string | undefined;
  if (method === "POST") {
    headers["Content-Type"] = "application/json";
    body = req ? await req.text() : "{}";
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${UPSTREAM}${path}`, { method, headers, body });
  } catch (err) {
    return Response.json({ error: `unreachable: ${(err as Error).message}` }, { status: 502 });
  }

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json" },
  });
}
