import { gateway } from "@ai-sdk/gateway";
import { generateImage } from "ai";

export const runtime = "nodejs";
export const maxDuration = 60;

const PROMPTS = [
  "Stylized circular portrait of a calm maneki-neko cat poker player, flat illustration, dark background, no text",
  "Stylized circular portrait of a shark in a suit, poker player, flat illustration, dark background, no text",
  "Stylized circular portrait of a young woman with short black hair, poker player, flat illustration, dark background, no text",
  "Stylized circular portrait of a bearded ram, poker player, flat illustration, dark background, no text",
  "Stylized circular portrait of a fox in a hoodie, poker player, flat illustration, dark background, no text",
  "Stylized circular portrait of an owl with round glasses, poker player, flat illustration, dark background, no text",
  "Stylized circular portrait of a panda in a jacket, poker player, flat illustration, dark background, no text",
  "Stylized circular portrait of a wolf with a cap, poker player, flat illustration, dark background, no text",
];

const cache = new Map<number, { bytes: Uint8Array; type: string }>();

export async function GET(_req: Request, ctx: { params: Promise<{ seat: string }> }) {
  const seat = Number((await ctx.params).seat);
  const prompt = PROMPTS[seat - 1];
  if (!prompt) return new Response("not found", { status: 404 });

  const hit = cache.get(seat);
  if (hit) return imageResponse(hit.bytes, hit.type);

  try {
    const { image } = await generateImage({
      model: gateway.imageModel("prodia/flux-fast-schnell"),
      prompt,
      aspectRatio: "1:1",
      seed: seat,
    });
    cache.set(seat, { bytes: image.uint8Array, type: image.mediaType });
    return imageResponse(image.uint8Array, image.mediaType);
  } catch {
    return new Response("unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

function imageResponse(bytes: Uint8Array, type: string) {
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": type || "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Vercel-CDN-Cache-Control": "public, s-maxage=31536000, immutable",
    },
  });
}
