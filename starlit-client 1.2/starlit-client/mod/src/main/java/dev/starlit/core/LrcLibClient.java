package dev.starlit.core;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;

/**
 * Client for LRCLIB (https://lrclib.net), a free, open lyrics database with synchronised lyrics and no account or API key.
 * Only blocking calls: always run it off the render thread (LyricsService does).
 */
public final class LrcLibClient {
    public record Result(String syncedLyrics, boolean hasPlainOnly) {}

    private final String base;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).followRedirects(HttpClient.Redirect.NORMAL).build();

    public LrcLibClient(String baseUrl) { this.base = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl; }
    public LrcLibClient() { this("https://lrclib.net"); }

    private static String enc(String s) { return URLEncoder.encode(s, StandardCharsets.UTF_8); }

    private String get(String path) throws Exception {
        HttpRequest req = HttpRequest.newBuilder(URI.create(base + path)).timeout(Duration.ofSeconds(8))
            .header("User-Agent", "StarlitMod/0.1 (Minecraft client mod)").header("Accept", "application/json").GET().build();
        HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (res.statusCode() == 404) return null;
        if (res.statusCode() / 100 != 2) throw new java.io.IOException("LRCLIB answered HTTP " + res.statusCode());
        return res.body();
    }

    /** @return the result, or null when LRCLIB has nothing for this track. Throws on network errors. */
    public Result find(String artist, String title, long durationMs) throws Exception {
        String exact = get("/api/get?track_name=" + enc(title) + "&artist_name=" + enc(artist)
            + (durationMs > 0 ? "&duration=" + Math.round(durationMs / 1000.0) : ""));
        if (exact != null) {
            Result r = fromTrack(MiniJson.parse(exact));
            if (r != null) return r;
        }
        String search = get("/api/search?q=" + enc((artist + " " + title).strip()));
        if (search == null) return null;
        Object parsed = MiniJson.parse(search);
        if (!(parsed instanceof List<?> list)) return null;
        Result plain = null;
        for (Object o : list) {
            Result r = fromTrack(o);
            if (r == null) continue;
            double dur = MiniJson.num(o, "duration", 0) * 1000;
            boolean durOk = durationMs <= 0 || dur <= 0 || Math.abs(dur - durationMs) <= 4000;
            if (!durOk) continue;
            if (!r.hasPlainOnly()) return r;
            plain = plain == null ? r : plain;
        }
        return plain;
    }

    private static Result fromTrack(Object o) {
        String synced = MiniJson.str(o, "syncedLyrics");
        if (synced != null && !synced.isBlank()) return new Result(synced, false);
        String plain = MiniJson.str(o, "plainLyrics");
        if (plain != null && !plain.isBlank()) return new Result(null, true);
        return null;
    }
}
