import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const IS_WIN = process.platform === "win32";
const BIN_DIR = path.join(process.cwd(), "bin");
const LOCAL_YTDLP = path.join(BIN_DIR, IS_WIN ? "yt-dlp.exe" : "yt-dlp");

let downloadPromise: Promise<string> | null = null;

function commandExists(cmd: string): string | null {
  const finder = IS_WIN ? "where" : "which";
  const res = spawnSync(finder, [cmd], { encoding: "utf8", windowsHide: true });
  if (res.status === 0 && res.stdout) {
    const first = res.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (first && fs.existsSync(first)) return first;
  }
  return null;
}

export function findFfmpegPath(): string | null {
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }

  const fromPath = commandExists(IS_WIN ? "ffmpeg.exe" : "ffmpeg");
  if (fromPath) return fromPath;

  const commonPaths = IS_WIN
    ? [
        "C:\\ffmpeg\\ffmpeg.exe",
        "C:\\ffmpeg\\bin\\ffmpeg.exe",
        "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
      ]
    : ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg"];

  for (const candidate of commonPaths) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

export async function ensureYtDlp(): Promise<string> {
  if (process.env.YTDLP_PATH && fs.existsSync(process.env.YTDLP_PATH)) {
    return process.env.YTDLP_PATH;
  }

  if (fs.existsSync(LOCAL_YTDLP)) {
    return LOCAL_YTDLP;
  }

  const fromPath = commandExists(IS_WIN ? "yt-dlp.exe" : "yt-dlp");
  if (fromPath) {
    return fromPath;
  }

  if (!downloadPromise) {
    downloadPromise = (async () => {
      await fsp.mkdir(BIN_DIR, { recursive: true });
      const fileName = IS_WIN
        ? "yt-dlp.exe"
        : process.platform === "darwin"
          ? "yt-dlp_macos"
          : "yt-dlp";
      const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${fileName}`;

      const res = await fetch(downloadUrl, { redirect: "follow" });
      if (!res.ok) {
        throw new Error(
          `تعذر تحميل أداة yt-dlp تلقائياً (HTTP ${res.status}).`
        );
      }

      const buf = Buffer.from(await res.arrayBuffer());
      const tempBin = `${LOCAL_YTDLP}.${crypto.randomBytes(4).toString("hex")}.tmp`;
      await fsp.writeFile(tempBin, buf);
      if (!IS_WIN) {
        await fsp.chmod(tempBin, 0o755);
      }
      await fsp.rename(tempBin, LOCAL_YTDLP);
      return LOCAL_YTDLP;
    })().finally(() => {
      downloadPromise = null;
    });
  }

  return downloadPromise;
}

function runProcess(
  bin: string,
  args: string[],
  timeoutMs = 180_000
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("انتهت مهلة معالجة الفيديو. جرّب مقطعاً أقصر."));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        if (stderr.trim()) {
          console.error("[yt-dlp stderr]\n" + stderr.trim().slice(-1200));
        }
        if (stderr.includes("cookies are no longer valid")) {
          reject(
            new Error(
              "انتهت صلاحية كوكيز يوتيوب على السيرفر. يرجى تحديث YTDLP_COOKIES_BASE64 أو حذفها."
            )
          );
          return;
        }
        const message =
          stderr
            .split(/\r?\n/)
            .filter((line) => line.toLowerCase().includes("error"))
            .pop() ||
          stderr.trim().slice(-400) ||
          `فشل تنفيذ yt-dlp (code ${code})`;
        reject(new Error(message));
      }
    });
  });
}

export interface VideoInfo {
  id: string;
  title: string;
  duration: number;
  thumbnail: string;
  channel: string;
}

function isEmptyOrPlaceholder(val?: string): boolean {
  if (!val) return true;
  const t = val.trim().toLowerCase();
  return !t || t === "none" || t === "null" || t === "false";
}

async function getCookiesArgs(): Promise<string[]> {
  const b64 = process.env.YTDLP_COOKIES_BASE64;
  const plain = process.env.YTDLP_COOKIES;

  const raw = !isEmptyOrPlaceholder(b64)
    ? Buffer.from(b64!.replace(/\s+/g, ""), "base64").toString("utf8")
    : !isEmptyOrPlaceholder(plain)
      ? plain!.trim()
      : "";

  if (!raw || !raw.trim()) {
    console.log("[yt-dlp] No cookies configured.");
    return [];
  }

  const lines = raw.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
  const hasAuth =
    raw.includes("SAPISID") ||
    raw.includes("LOGIN_INFO") ||
    raw.includes("__Secure-3PSID");

  console.log(
    `[yt-dlp] Loaded cookies: ${lines.length} entries, hasYouTubeAuth=${hasAuth}`
  );

  const cookiePath = path.join(os.tmpdir(), "yt-dlp-cookies.txt");
  await fsp.writeFile(cookiePath, raw, "utf8");
  return ["--cookies", cookiePath];
}

function getCommonYtDlpArgs(): string[] {
  const args = [
    "-4",
    "--js-runtimes",
    "deno",
    "--js-runtimes",
    "node",
    "--remote-components",
    "ejs:github",
    "--no-playlist",
  ];

  const extractorArgs: string[] = [];
  const bgutilHome = process.env.BGUTIL_SERVER_HOME;
  if (bgutilHome && fs.existsSync(bgutilHome)) {
    extractorArgs.push(`youtubepot-bgutilscript:server_home=${bgutilHome}`);
    extractorArgs.push("youtube:player_client=mweb,tv,web");
  }

  if (extractorArgs.length > 0) {
    args.push("--extractor-args", extractorArgs.join(";"));
  }

  return args;
}

export async function getVideoInfo(url: string): Promise<VideoInfo> {
  const ytdlp = await ensureYtDlp();
  const cookieArgs = await getCookiesArgs();
  const args = [
    ...getCommonYtDlpArgs(),
    ...cookieArgs,
    "--dump-single-json",
    "--skip-download",
    url,
  ];

  const { stdout } = await runProcess(ytdlp, args, 45_000);
  const data = JSON.parse(stdout);

  return {
    id: String(data.id ?? ""),
    title: String(data.title ?? "YouTube Video"),
    duration: Number(data.duration ?? 0),
    thumbnail: String(
      data.thumbnail ?? `https://i.ytimg.com/vi/${data.id}/hqdefault.jpg`
    ),
    channel: String(data.channel ?? data.uploader ?? ""),
  };
}

export interface SliceResult {
  filePath: string;
  tempDir: string;
  cleanup: () => Promise<void>;
}

export async function sliceYouTubeVideo(
  url: string,
  startSeconds: number,
  endSeconds: number
): Promise<SliceResult> {
  const ytdlp = await ensureYtDlp();
  const ffmpeg = findFfmpegPath();

  if (!ffmpeg) {
    throw new Error(
      "برنامج FFmpeg غير مثبت على الجهاز. يرجى تثبيت FFmpeg لقص الفيديو."
    );
  }

  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "yt-slice-"));
  const outputTemplate = path.join(tempDir, "clip.%(ext)s");

  const cleanup = async () => {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  };

  try {
    const cookieArgs = await getCookiesArgs();
    const maxHeight = Number(process.env.MAX_HEIGHT || 0);
    const formatSelector =
      maxHeight > 0
        ? `bv*[height<=${maxHeight}][ext=mp4]+ba[ext=m4a]/b[height<=${maxHeight}][ext=mp4]/bv*[height<=${maxHeight}]+ba/bv*+ba/b/best`
        : "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b/best";
    const section = `*${startSeconds}-${endSeconds}`;
    const args = [
      ...getCommonYtDlpArgs(),
      ...cookieArgs,
      "--ffmpeg-location",
      ffmpeg,
      "--download-sections",
      section,
      "--force-keyframes-at-cuts",
      "-f",
      formatSelector,
      "--merge-output-format",
      "mp4",
      "-o",
      outputTemplate,
      url,
    ];

    await runProcess(ytdlp, args, 300_000);

    const files = await fsp.readdir(tempDir);
    const mediaFile =
      files.find((f) => f.endsWith(".mp4")) ||
      files.find((f) => !f.endsWith(".part") && !f.endsWith(".ytdl"));

    if (!mediaFile) {
      throw new Error("لم يتم إنتاج ملف الفيديو المقصوص.");
    }

    return {
      filePath: path.join(tempDir, mediaFile),
      tempDir,
      cleanup,
    };
  } catch (err) {
    await cleanup();
    throw err;
  }
}
