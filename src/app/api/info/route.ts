import { NextRequest, NextResponse } from "next/server";
import { normalizeYouTubeUrl } from "@/lib/time";
import { getVideoInfo } from "@/lib/ytdlp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const rawUrl = req.nextUrl.searchParams.get("url") ?? "";
  const normalizedUrl = normalizeYouTubeUrl(rawUrl);

  if (!normalizedUrl) {
    return NextResponse.json(
      { error: "الرابط غير صالح. يرجى إدخال رابط فيديو يوتيوب صحيح." },
      { status: 400 }
    );
  }

  try {
    const info = await getVideoInfo(normalizedUrl);
    return NextResponse.json(info);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "تعذر جلب بيانات الفيديو.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
