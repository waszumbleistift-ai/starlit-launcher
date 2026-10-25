package dev.starlit.core;

/** Snapshot of what the operating system says is playing. Position is extrapolated while playing. */
public record PlaybackState(String status, String title, String artist, long positionMs, long durationMs, boolean playing, long sampleNanos) {
    public static final String OK = "ok", NONE = "none", UNSUPPORTED = "unsupported", ERROR = "error";

    public static PlaybackState of(String status) { return new PlaybackState(status, "", "", 0, 0, false, System.nanoTime()); }

    public boolean hasTrack() { return OK.equals(status) && !title.isBlank(); }

    public long positionNow() {
        if (!playing) return positionMs;
        long p = positionMs + (System.nanoTime() - sampleNanos) / 1_000_000;
        return durationMs > 0 ? Math.min(p, durationMs) : p;
    }

    /** Stable identity of the track, used for caches and change detection. */
    public String key() { return normalize(artist) + "|" + normalize(title); }

    public static String normalize(String s) {
        if (s == null) return "";
        return s.toLowerCase().replaceAll("\\(.*?\\)|\\[.*?]", " ").replaceAll("[^\\p{L}\\p{N}]+", " ").strip();
    }
}
