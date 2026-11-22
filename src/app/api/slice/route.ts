import fs from "node:fs";
import fsp from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { formatSeconds, normalizeYouTubeUrl } from "@/lib/time";
import { sliceYouTubeVideo } from "@/lib/ytdlp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function sanitizeFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export async function POST(req: NextRequest) {
  let body: {
    url?: string;
    start?: number;
    end?: number;
    title?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "بيانات الطلب غير صالحة." },
      { status: 400 }
    );
  }

  const normalizedUrl = normalizeYouTubeUrl(body.url ?? "");
  if (!normalizedUrl) {
    return NextResponse.json(
      { error: "رابط يوتيوب غير صحيح." },
      { status: 400 }
    );
  }

  const start = Number(body.start);
  const end = Number(body.end);

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end <= start
  ) {
    return NextResponse.json(
      { error: "يرجى التأكد أن وقت النهاية أكبر من وقت البداية." },
      { status: 400 }
    );
  }

  try {
    const { filePath, cleanup } = await sliceYouTubeVideo(
      normalizedUrl,
      start,
      end
    );

    const stat = await fsp.stat(filePath);
    const startLabel = formatSeconds(start).replace(/:/g, "-");
    const endLabel = formatSeconds(end).replace(/:/g, "-");
    const cleanTitle = sanitizeFileName(body.title || "youtube-clip") || "youtube-clip";
    const fullFileName = `${cleanTitle} (${startLabel} to ${endLabel}).mp4`;
    const asciiFallback = `youtube-clip-${startLabel}-${endLabel}.mp4`;

    const nodeStream = fs.createReadStream(filePath);
    let cleaned = false;
    const safeCleanup = () => {
      if (cleaned) return;
      cleaned = true;
      void cleanup();
    };

    const webStream = new ReadableStream<Uint8Array>({
      start(controller) {
        nodeStream.on("data", (chunk: Buffer | string) => {
          controller.enqueue(
            typeof chunk === "string" ? Buffer.from(chunk) : new Uint8Array(chunk)
          );
        });
        nodeStream.on("end", () => {
          controller.close();
          safeCleanup();
        });
        nodeStream.on("error", (err) => {
          controller.error(err);
          safeCleanup();
        });
      },
      cancel() {
        nodeStream.destroy();
        safeCleanup();
      },
    });

    return new NextResponse(webStream, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(stat.size),
        "Content-Disposition": `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fullFileName)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "حدث خطأ أثناء قص الفيديو.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
