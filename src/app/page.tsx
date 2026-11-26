"use client";

import { useState } from "react";
import {
  extractYouTubeId,
  formatSeconds,
  parseTimeToSeconds,
} from "@/lib/time";

interface VideoInfo {
  id: string;
  title: string;
  duration: number;
  thumbnail: string;
  channel: string;
}

interface ProgressState {
  percent: number;
  stage: string;
  etaSeconds: number | null;
}

function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) {
    return "جاري الحساب...";
  }
  if (seconds < 60) {
    return `~${Math.ceil(seconds)} ثانية`;
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.ceil(seconds % 60);
  return secs > 0 ? `~${mins} د ${secs} ث` : `~${mins} دقيقة`;
}

export default function HomePage() {
  const [url, setUrl] = useState("");
  const [video, setVideo] = useState<VideoInfo | null>(null);
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(15);
  const [startInput, setStartInput] = useState("00:00");
  const [endInput, setEndInput] = useState("00:15");
  const [preciseCut, setPreciseCut] = useState(false);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [slicing, setSlicing] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function handleLoadVideo(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus(null);
    setProgress(null);

    const id = extractYouTubeId(url);
    if (!id) {
      setError("أدخل رابط فيديو يوتيوب صحيح.");
      return;
    }

    setLoadingInfo(true);
    try {
      const res = await fetch(`/api/info?url=${encodeURIComponent(url.trim())}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "تعذر تحميل بيانات الفيديو.");
      }

      const duration = Math.max(1, Math.floor(data.duration || 0));
      const initialEnd = Math.min(duration, 30);

      setVideo(data);
      setStartSec(0);
      setEndSec(initialEnd);
      setStartInput(formatSeconds(0));
      setEndInput(formatSeconds(initialEnd));
    } catch (err) {
      setVideo(null);
      setError(err instanceof Error ? err.message : "حدث خطأ غير متوقع.");
    } finally {
      setLoadingInfo(false);
    }
  }

  function updateStart(next: number) {
    if (!video) return;
    const clamped = Math.max(0, Math.min(next, Math.max(0, endSec - 1)));
    setStartSec(clamped);
    setStartInput(formatSeconds(clamped));
  }

  function updateEnd(next: number) {
    if (!video) return;
    const max = Math.max(1, Math.floor(video.duration));
    const clamped = Math.min(max, Math.max(next, startSec + 1));
    setEndSec(clamped);
    setEndInput(formatSeconds(clamped));
  }

  function handleStartBlur() {
    const parsed = parseTimeToSeconds(startInput);
    if (parsed === null) {
      setStartInput(formatSeconds(startSec));
      return;
    }
    updateStart(Math.floor(parsed));
  }

  function handleEndBlur() {
    const parsed = parseTimeToSeconds(endInput);
    if (parsed === null) {
      setEndInput(formatSeconds(endSec));
      return;
    }
    updateEnd(Math.floor(parsed));
  }

  async function downloadReadyClip(
    jobId: string,
    fileName: string,
    expectedSize: number
  ) {
    const dlRes = await fetch(`/api/slice/download/${encodeURIComponent(jobId)}`);
    if (!dlRes.ok) {
      const data = await dlRes.json().catch(() => ({}));
      throw new Error(data.error || "تعذر تحميل الملف المقصوص.");
    }

    const total = Number(dlRes.headers.get("Content-Length")) || expectedSize;
    const reader = dlRes.body?.getReader();

    let blob: Blob;
    if (reader && total > 0) {
      const chunks: BlobPart[] = [];
      let received = 0;
      const startedAt = Date.now();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(new Uint8Array(value));
          received += value.byteLength;
          const dlRatio = Math.min(1, received / total);
          const elapsedSec = Math.max(0.1, (Date.now() - startedAt) / 1000);
          const speedBps = received / elapsedSec;
          const eta = speedBps > 0 ? (total - received) / speedBps : 1;

          setProgress({
            percent: Math.min(100, Math.round(94 + dlRatio * 6)),
            stage: `جاري تنزيل الملف (${(received / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)} MB)`,
            etaSeconds: eta,
          });
        }
      }
      blob = new Blob(chunks, { type: "video/mp4" });
    } else {
      blob = await dlRes.blob();
    }

    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(downloadUrl);
  }

  async function handleSliceDownload() {
    if (!video) return;
    setError(null);
    setStatus(null);

    const parsedStart = parseTimeToSeconds(startInput) ?? startSec;
    const parsedEnd = parseTimeToSeconds(endInput) ?? endSec;

    if (parsedEnd <= parsedStart) {
      setError("وقت النهاية يجب أن يكون أكبر من وقت البداية.");
      return;
    }

    setSlicing(true);
    setProgress({
      percent: 5,
      stage: "جاري إرسال الطلب للسيرفر...",
      etaSeconds: null,
    });

    try {
      const res = await fetch("/api/slice/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: `https://www.youtube.com/watch?v=${video.id}`,
          start: parsedStart,
          end: parsedEnd,
          title: video.title,
          precise: preciseCut,
        }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "فشل بدء قص الفيديو.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let readyJob: { jobId: string; fileName: string; size: number } | null =
        null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const rawEvent of events) {
          const dataLine = rawEvent
            .split("\n")
            .find((l) => l.startsWith("data: "));
          if (!dataLine) continue;

          const event = JSON.parse(dataLine.slice(6));
          if (event.type === "progress") {
            setProgress({
              percent: event.percent,
              stage: event.stage,
              etaSeconds: event.etaSeconds ?? null,
            });
          } else if (event.type === "done") {
            readyJob = {
              jobId: event.jobId,
              fileName: event.fileName,
              size: event.size,
            };
          } else if (event.type === "error") {
            throw new Error(event.error || "حدث خطأ أثناء قص الفيديو.");
          }
        }
      }

      if (!readyJob) {
        throw new Error("انقطع الاتصال قبل اكتمال قص الفيديو.");
      }

      setProgress({
        percent: 94,
        stage: "جاري حفظ الفيديو على جهازك...",
        etaSeconds: 1,
      });

      await downloadReadyClip(readyJob.jobId, readyJob.fileName, readyJob.size);

      setProgress({
        percent: 100,
        stage: "اكتمل التحميل!",
        etaSeconds: 0,
      });
      setStatus("تم قص الفيديو وحفظه على جهازك بنجاح.");
    } catch (err) {
      setProgress(null);
      setStatus(null);
      setError(err instanceof Error ? err.message : "حدث خطأ أثناء التحميل.");
    } finally {
      setSlicing(false);
    }
  }

  const clipLength = Math.max(0, endSec - startSec);
  const maxDuration = Math.max(1, Math.floor(video?.duration || 1));

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center px-4 py-10">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-6 shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-600 text-white">
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="6" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <line x1="20" y1="4" x2="8.12" y2="15.88" />
              <line x1="14.47" y1="14.48" x2="20" y2="20" />
              <line x1="8.12" y1="8.12" x2="12" y2="12" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">قص فيديو يوتيوب</h1>
            <p className="text-sm text-zinc-400">
              ضع رابط الفيديو، حدد وقت البداية والنهاية، واحفظ الجزء مباشرة.
            </p>
          </div>
        </div>

        <form onSubmit={handleLoadVideo} className="flex gap-2">
          <input
            type="text"
            dir="ltr"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            className="flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-white placeholder-zinc-500 outline-none transition focus:border-red-500"
            disabled={loadingInfo || slicing}
          />
          <button
            type="submit"
            disabled={loadingInfo || slicing || !url.trim()}
            className="rounded-xl bg-zinc-100 px-5 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loadingInfo ? "جاري الجلب..." : "جلب"}
          </button>
        </form>

        {error && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {status && !error && (
          <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
            {status}
          </div>
        )}

        {video && (
          <div className="mt-6 space-y-5 border-t border-zinc-800 pt-6">
            <div className="overflow-hidden rounded-xl border border-zinc-800 bg-black">
              <iframe
                key={video.id}
                className="aspect-video w-full"
                src={`https://www.youtube.com/embed/${video.id}`}
                title={video.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>

            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-white">
                  {video.title}
                </h2>
                {video.channel && (
                  <p className="text-xs text-zinc-400">{video.channel}</p>
                )}
              </div>
              <span
                dir="ltr"
                className="shrink-0 rounded-lg bg-zinc-800 px-2.5 py-1 text-xs font-mono text-zinc-300"
              >
                {formatSeconds(video.duration)}
              </span>
            </div>

            <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-xs text-zinc-400">
                    بداية القص
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    value={startInput}
                    onChange={(e) => setStartInput(e.target.value)}
                    onBlur={handleStartBlur}
                    disabled={slicing}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-center font-mono text-sm text-white outline-none focus:border-red-500"
                  />
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, maxDuration - 1)}
                    value={startSec}
                    onChange={(e) => updateStart(Number(e.target.value))}
                    disabled={slicing}
                    className="mt-2 w-full cursor-pointer"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs text-zinc-400">
                    نهاية القص
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    value={endInput}
                    onChange={(e) => setEndInput(e.target.value)}
                    onBlur={handleEndBlur}
                    disabled={slicing}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-center font-mono text-sm text-white outline-none focus:border-red-500"
                  />
                  <input
                    type="range"
                    min={1}
                    max={maxDuration}
                    value={endSec}
                    onChange={(e) => updateEnd(Number(e.target.value))}
                    disabled={slicing}
                    className="mt-2 w-full cursor-pointer"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>مدة المقطع المقصوص</span>
                <span dir="ltr" className="font-mono font-semibold text-white">
                  {formatSeconds(clipLength)}
                </span>
              </div>

              <label className="flex cursor-pointer items-center justify-between gap-3 border-t border-zinc-800/80 pt-3 text-xs text-zinc-300">
                <span>
                  قص دقيق بالثانية{" "}
                  <span className="text-zinc-500">(أبطأ — يعيد ترميز الفيديو)</span>
                </span>
                <input
                  type="checkbox"
                  checked={preciseCut}
                  onChange={(e) => setPreciseCut(e.target.checked)}
                  disabled={slicing}
                  className="h-4 w-4 accent-red-600"
                />
              </label>
            </div>

            {progress && (
              <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/80 p-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-zinc-200">
                    {progress.stage}
                  </span>
                  <span dir="ltr" className="font-mono font-semibold text-red-400">
                    {progress.percent}%
                  </span>
                </div>

                <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-l from-red-500 to-rose-600 transition-all duration-300"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] text-zinc-400">
                  <span>
                    {progress.percent < 100
                      ? `الوقت المتبقي: ${formatEta(progress.etaSeconds)}`
                      : "تم حفظ الملف بنجاح"}
                  </span>
                  <span>{preciseCut ? "وضع دقيق" : "وضع سريع ⚡"}</span>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={handleSliceDownload}
              disabled={slicing || clipLength <= 0}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {slicing ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  <span>جاري القص والتحميل ({progress?.percent ?? 0}%)...</span>
                </>
              ) : (
                <span>قص وحفظ الفيديو (MP4)</span>
              )}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
