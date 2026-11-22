export function extractYouTubeId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();

    if (host === "youtu.be") {
      const id = parsed.pathname.slice(1).split("/")[0];
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }

    if (
      host === "youtube.com" ||
      host === "m.youtube.com" ||
      host === "music.youtube.com"
    ) {
      const v = parsed.searchParams.get("v");
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;

      const parts = parsed.pathname.split("/").filter(Boolean);
      if (
        parts.length >= 2 &&
        (parts[0] === "shorts" || parts[0] === "embed" || parts[0] === "live")
      ) {
        return /^[a-zA-Z0-9_-]{11}$/.test(parts[1]) ? parts[1] : null;
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function normalizeYouTubeUrl(input: string): string | null {
  const id = extractYouTubeId(input);
  if (!id) return null;
  return `https://www.youtube.com/watch?v=${id}`;
}

export function formatSeconds(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;

  const pad = (n: number) => String(n).padStart(2, "0");
  if (hrs > 0) {
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

export function parseTimeToSeconds(value: string): number | null {
  const cleaned = value.trim();
  if (!cleaned) return null;

  if (/^\d+(\.\d+)?$/.test(cleaned)) {
    const num = Number(cleaned);
    return Number.isFinite(num) && num >= 0 ? num : null;
  }

  const parts = cleaned.split(":");
  if (parts.length < 2 || parts.length > 3) return null;

  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;

  if (nums.length === 2) {
    const [m, s] = nums;
    if (s >= 60) return null;
    return m * 60 + s;
  }

  const [h, m, s] = nums;
  if (m >= 60 || s >= 60) return null;
  return h * 3600 + m * 60 + s;
}
