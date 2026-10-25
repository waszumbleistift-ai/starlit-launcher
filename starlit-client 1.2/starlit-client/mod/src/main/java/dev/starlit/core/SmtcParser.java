package dev.starlit.core;

/** Parses one JSON line printed by the Windows media script. */
public final class SmtcParser {
    private SmtcParser() {}

    public static PlaybackState parse(String line, long nowNanos) {
        try {
            Object o = MiniJson.parse(line);
            String status = MiniJson.str(o, "status");
            if (status == null || !status.equals("ok")) return new PlaybackState(status == null ? PlaybackState.ERROR : status, "", "", 0, 0, false, nowNanos);
            return new PlaybackState(PlaybackState.OK, nz(MiniJson.str(o, "title")), nz(MiniJson.str(o, "artist")),
                Math.max(0, (long) MiniJson.num(o, "pos", 0)), Math.max(0, (long) MiniJson.num(o, "end", 0)), MiniJson.bool(o, "playing", false), nowNanos);
        } catch (RuntimeException e) {
            return new PlaybackState(PlaybackState.ERROR, "", "", 0, 0, false, nowNanos);
        }
    }

    private static String nz(String s) { return s == null ? "" : s; }
}
