import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { takeReadyJob } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await context.params;
  const job = takeReadyJob(jobId);

  if (!job) {
    return NextResponse.json(
      { error: "انتهت صلاحية رابط التحميل. يرجى إعادة قص الفيديو." },
      { status: 404 }
    );
  }

  const nodeStream = fs.createReadStream(job.filePath);
  let cleaned = false;
  const safeCleanup = () => {
    if (cleaned) return;
    cleaned = true;
    void job.cleanup();
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
      "Content-Length": String(job.size),
      "Content-Disposition": `attachment; filename="${job.asciiFileName}"; filename*=UTF-8''${encodeURIComponent(job.fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}
