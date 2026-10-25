package dev.starlit.core;

import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Follows the current track, finds its lyrics (own file > cache > LRCLIB) and tells the renderer which line to show.
 * All network access and waiting happens on two daemon threads; view() is cheap and safe to call every frame.
 * close() stops both threads and the media helper process.
 */
public final class LyricsService implements AutoCloseable {
    public enum Status { NO_SOURCE, NO_PLAYER, FETCHING, NO_LYRICS, UNSYNCED, OFFLINE, READY, PAUSED, PREVIEW }

    public record View(Status status, String title, String artist, String line, String previousLine, long lineChangedNanos, String message) {}

    public static final List<LrcParser.Line> PREVIEW = List.of(
        new LrcParser.Line(0, "Light is pouring through the sky"), new LrcParser.Line(3000, "Every colour passing by"),
        new LrcParser.Line(6000, "Words are floating in the air"), new LrcParser.Line(9000, "Starlit, and I'm right there"));

    private final MediaSource source;
    private final LrcLibClient online;
    private final LyricsStore store;
    private final ScheduledExecutorService poller = Executors.newSingleThreadScheduledExecutor(daemon("starlit-lyrics-poll"));
    private final java.util.concurrent.ExecutorService fetcher = Executors.newSingleThreadExecutor(daemon("starlit-lyrics-fetch"));

    private volatile PlaybackState state = PlaybackState.of(PlaybackState.NONE);
    private volatile String trackKey = "";
    private volatile List<LrcParser.Line> lines = null;
    private volatile Status fetchStatus = Status.NO_PLAYER;
    private volatile boolean preview;
    private volatile long offsetMs;
    private volatile long previewStart = System.nanoTime();
    private final java.util.Map<String, Long> failedAt = new java.util.concurrent.ConcurrentHashMap<>();

    private List<LrcParser.Line> lastLines;
    private int lastIndex = -2;
    private String lastLine = "", prevLine = "";
    private long changedNanos = System.nanoTime();

    public LyricsService(MediaSource source, LrcLibClient online, LyricsStore store) {
        this.source = source; this.online = online; this.store = store;
    }

    private static java.util.concurrent.ThreadFactory daemon(String name) {
        return r -> { Thread t = new Thread(r, name); t.setDaemon(true); return t; };
    }

    public void start() { poller.scheduleWithFixedDelay(this::tick, 0, 400, TimeUnit.MILLISECONDS); }

    public void setPreview(boolean on) { if (on && !preview) previewStart = System.nanoTime(); preview = on; }
    public void setOffsetMs(long ms) { offsetMs = ms; }
    public String sourceName() { return source == null ? "none" : source.name(); }

    private void tick() {
        try {
            if (source == null) { fetchStatus = Status.NO_SOURCE; return; }
            PlaybackState st = source.poll();
            state = st;
            if (!st.hasTrack()) {
                trackKey = ""; lines = null;
                fetchStatus = PlaybackState.UNSUPPORTED.equals(st.status()) ? Status.NO_SOURCE : Status.NO_PLAYER;
                return;
            }
            String key = st.key();
            if (!key.equals(trackKey)) {
                trackKey = key; lines = null; fetchStatus = Status.FETCHING;
                final PlaybackState snapshot = st;
                fetcher.submit(() -> load(key, snapshot));
            }
        } catch (RuntimeException ignored) { /* keep running */ }
    }

    private void load(String key, PlaybackState st) {
        try {
            String lrc = store.userFile(st);
            if (lrc == null) lrc = store.cached(key);
            if (lrc == null && online != null) {
                Long failed = failedAt.get(key);
                if (failed != null && System.nanoTime() - failed < 600_000_000_000L) { finish(key, null, Status.NO_LYRICS); return; }
                LrcLibClient.Result r = online.find(st.artist(), st.title(), st.durationMs());
                if (r == null) { failedAt.put(key, System.nanoTime()); finish(key, null, Status.NO_LYRICS); return; }
                if (r.hasPlainOnly()) { failedAt.put(key, System.nanoTime()); finish(key, null, Status.UNSYNCED); return; }
                lrc = r.syncedLyrics();
                store.cache(key, lrc);
            }
            List<LrcParser.Line> parsed = lrc == null ? List.of() : LrcParser.parse(lrc);
            finish(key, parsed.isEmpty() ? null : parsed, parsed.isEmpty() ? Status.NO_LYRICS : Status.READY);
        } catch (Exception e) {
            failedAt.put(key, System.nanoTime() - 540_000_000_000L); // retry after about a minute
            finish(key, null, Status.OFFLINE);
        }
    }

    private void finish(String key, List<LrcParser.Line> parsed, Status status) {
        if (!key.equals(trackKey)) return; // the track changed while we were loading
        lines = parsed; fetchStatus = status;
    }

    /** Safe to call every frame from the render thread. */
    public synchronized View view() {
        List<LrcParser.Line> ls;
        long pos;
        Status status;
        PlaybackState st = state;
        if (preview) {
            ls = PREVIEW; status = Status.PREVIEW;
            pos = ((System.nanoTime() - previewStart) / 1_000_000) % 12_000;
        } else {
            ls = lines; status = fetchStatus; pos = st.positionNow() + offsetMs;
            if (ls != null && !st.playing()) status = Status.PAUSED;
            else if (ls != null) status = Status.READY;
        }
        int idx = ls == null ? -1 : LrcParser.indexAt(ls, pos);
        if (ls != lastLines) { // another song (or preview): never show the old song's line or fade from it
            lastLines = ls; lastIndex = -2; lastLine = ""; prevLine = "";
        }
        if (idx != lastIndex) {
            prevLine = lastLine;
            lastLine = idx >= 0 ? ls.get(idx).text() : "";
            lastIndex = idx; changedNanos = System.nanoTime();
        }
        String shown = status == Status.READY || status == Status.PAUSED || status == Status.PREVIEW ? lastLine : "";
        return new View(status, st.title(), st.artist(), shown, prevLine, changedNanos, message(status));
    }

    public static String message(Status s) {
        return switch (s) {
            case NO_SOURCE -> "No music source available on this system";
            case NO_PLAYER -> "No music is playing";
            case FETCHING -> "Looking for lyrics…";
            case NO_LYRICS -> "No synced lyrics found. Put a .lrc file into the lyrics folder";
            case UNSYNCED -> "Only unsynced lyrics exist for this song";
            case OFFLINE -> "Could not reach the lyrics service";
            case READY -> "Showing lyrics";
            case PAUSED -> "Paused";
            case PREVIEW -> "Preview";
        };
    }

    @Override public void close() {
        poller.shutdownNow();
        fetcher.shutdownNow();
        if (source != null) source.close();
    }
}
