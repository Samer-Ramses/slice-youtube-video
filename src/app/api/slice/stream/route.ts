import crypto from "node:crypto";
import fsp from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { formatSeconds, normalizeYouTubeUrl } from "@/lib/time";
import { sliceYouTubeVideo } from "@/lib/ytdlp";
import { saveReadyJob } from "@/lib/jobs";

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
    precise?: boolean;
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
  const precise = Boolean(body.precise);

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

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (payload: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
          );
        } catch {
          closed = true;
        }
      };

      const heartbeat = setInterval(() => {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
          } catch {
            closed = true;
          }
        }
      }, 10_000);

      try {
        const { filePath, cleanup } = await sliceYouTubeVideo(
          normalizedUrl,
          start,
          end,
          {
            precise,
            onProgress(progress) {
              send({ type: "progress", ...progress });
            },
          }
        );

        const stat = await fsp.stat(filePath);
        const startLabel = formatSeconds(start).replace(/:/g, "-");
        const endLabel = formatSeconds(end).replace(/:/g, "-");
        const cleanTitle =
          sanitizeFileName(body.title || "youtube-clip") || "youtube-clip";
        const fileName = `${cleanTitle} (${startLabel}-${endLabel}).mp4`;
        const asciiFileName = `youtube-clip-${startLabel}-${endLabel}.mp4`;

        const jobId = crypto.randomBytes(12).toString("hex");
        saveReadyJob({
          id: jobId,
          filePath,
          fileName,
          asciiFileName,
          size: stat.size,
          cleanup,
        });

        send({
          type: "done",
          jobId,
          fileName,
          size: stat.size,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "حدث خطأ أثناء قص الفيديو.";
        send({ type: "error", error: message });
      } finally {
        clearInterval(heartbeat);
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
