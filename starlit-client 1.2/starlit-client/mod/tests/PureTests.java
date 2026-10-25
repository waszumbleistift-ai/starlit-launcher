import com.sun.net.httpserver.HttpServer;
import dev.starlit.core.*;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;

/** Dependency-free tests for the Minecraft-free part of the mod. Run with tests/run.sh (or run.ps1). */
public class PureTests {
    static int passed = 0, failed = 0;

    static void check(String name, boolean ok) {
        if (ok) passed++; else { failed++; System.out.println("FAIL: " + name); }
    }
    static void eq(String name, Object a, Object b) {
        boolean ok = Objects.equals(a, b);
        if (!ok) System.out.println("  expected <" + b + "> got <" + a + ">");
        check(name, ok);
    }

    public static void main(String[] args) throws Exception {
        String themeFile = args.length > 0 ? args[0] : null;
        json(); colors(); theme(themeFile); lrc(); smtc(); playback(); lrclib(); service(); process(); sky(); windows();
        System.out.println(passed + " checks passed, " + failed + " failed");
        System.exit(failed == 0 ? 0 : 1);
    }

    static void json() {
        Object o = MiniJson.parse("{\"a\":[1,2.5,{\"b\":\"x\\ny\\u00e9\"}],\"t\":true,\"n\":null}");
        eq("json nested string", MiniJson.str(((List<?>) MiniJson.object(o).get("a")).get(2), "b"), "x\nyé");
        eq("json bool", MiniJson.bool(o, "t", false), true);
        eq("json num default", MiniJson.num(o, "missing", 7), 7.0);
        boolean threw = false;
        try { MiniJson.parse("{\"a\":"); } catch (RuntimeException e) { threw = true; }
        check("json invalid throws", threw);
    }

    static void colors() {
        eq("hex parse", ColorMath.parseHex("#AaBbCc", 0), 0xFFAABBCC);
        eq("hex short", ColorMath.parseHex("fff", 0), 0xFFFFFFFF);
        eq("hex invalid -> fallback", ColorMath.parseHex("#12", 42), 42);
        eq("mix mid", ColorMath.mix(0xFF000000, 0xFFFFFFFF, 0.5f) & 0xFFFFFF, 0x808080);
        eq("scaleAlpha", ColorMath.a(ColorMath.scaleAlpha(0xFF123456, 0.5f)), 128);
        eq("toHex", ColorMath.toHex(0xFFB44CFF), "#B44CFF");
    }

    static void theme(String file) throws Exception {
        eq("defaults primary", ThemeData.defaults().primary, 0xFFB44CFF);
        eq("broken json -> defaults", ThemeData.parse("not json").primary, 0xFFB44CFF);
        ThemeData t = ThemeData.parse("{\"colors\":{\"primary\":\"#112233\",\"accent\":\"zzz\"},\"effects\":{\"glow\":5}}");
        eq("custom primary", t.primary, 0xFF112233);
        eq("invalid accent falls back", t.accent, 0xFF4FE0E8);
        eq("effect clamped", t.glow, 1f);
        if (file != null) {
            ThemeData l = ThemeData.load(Path.of(file));
            eq("launcher file: crimson primary", l.primary, 0xFFFF3D57);
            eq("launcher file: name", l.name, "Crimson");
            check("launcher file: glow 0..1", l.glow > 0 && l.glow <= 1);
        }
        Path dir = Files.createTempDirectory("starlit-theme");
        Path f = dir.resolve("theme.json");
        Files.writeString(f, "{\"colors\":{\"primary\":\"#010203\"}}");
        ThemeHolder h = new ThemeHolder(f);
        eq("holder initial", h.get().primary, 0xFF010203);
        Files.writeString(f, "{\"colors\":{\"primary\":\"#040506\"}}");
        Files.setLastModifiedTime(f, java.nio.file.attribute.FileTime.fromMillis(System.currentTimeMillis() + 5000));
        Thread.sleep(1100);
        eq("holder live reload", h.poll().primary, 0xFF040506);
        Files.delete(f);
        Thread.sleep(1100);
        eq("holder keeps theme when file vanishes", h.poll().primary, 0xFF040506);
        eq("holder without file", new ThemeHolder(null).get().primary, 0xFFB44CFF);
    }

    static void lrc() {
        String src = "﻿[ar:Someone]\n[ti:Song]\n[00:12.34]Hello\n[01:00.5][00:30]Chorus <00:31.00>word\n[00:05]\n[02:00.123]End\njunk line\n";
        List<LrcParser.Line> l = LrcParser.parse(src);
        eq("line count", l.size(), 5);
        eq("sorted first", l.get(0).timeMs(), 5000L);
        eq("empty line kept", l.get(0).text(), "");
        eq("fraction .34", l.get(1).timeMs(), 12340L);
        eq("multi stamp 30s", l.get(2).timeMs(), 30000L);
        eq("word stamps removed", l.get(2).text(), "Chorus word");
        eq("multi stamp 1:00.5", l.get(3).timeMs(), 60500L);
        eq("3 digit fraction", l.get(4).timeMs(), 120123L);
        List<LrcParser.Line> off = LrcParser.parse("[offset:+500]\n[00:10.00]A");
        eq("positive offset = earlier", off.get(0).timeMs(), 9500L);
        eq("indexAt before first", LrcParser.indexAt(l, 1000), -1);
        eq("indexAt exact", LrcParser.indexAt(l, 12340), 1);
        eq("indexAt between", LrcParser.indexAt(l, 59000), 2);
        eq("indexAt after last", LrcParser.indexAt(l, 999999), 4);
        eq("parse null", LrcParser.parse(null).size(), 0);
        eq("parse garbage", LrcParser.parse("hello\nworld").size(), 0);
    }

    static void smtc() {
        PlaybackState s = SmtcParser.parse("{\"status\":\"ok\",\"title\":\"Song\",\"artist\":\"Band\",\"pos\":1500,\"end\":200000,\"playing\":true}", 0);
        check("smtc ok", s.hasTrack() && s.playing());
        eq("smtc title", s.title(), "Song"); eq("smtc pos", s.positionMs(), 1500L); eq("smtc dur", s.durationMs(), 200000L);
        eq("smtc none", SmtcParser.parse("{\"status\":\"none\"}", 0).status(), "none");
        eq("smtc garbage", SmtcParser.parse("{oops", 0).status(), "error");
        check("smtc null title", !SmtcParser.parse("{\"status\":\"ok\",\"title\":null}", 0).hasTrack());
    }

    static void playback() throws Exception {
        long now = System.nanoTime();
        PlaybackState playing = new PlaybackState("ok", "T", "A", 10_000, 0, true, now - 2_000_000_000L);
        long p = playing.positionNow();
        check("extrapolates ~2s", p >= 11_900 && p <= 12_300);
        PlaybackState paused = new PlaybackState("ok", "T", "A", 10_000, 0, false, now - 2_000_000_000L);
        eq("paused does not move", paused.positionNow(), 10_000L);
        PlaybackState end = new PlaybackState("ok", "T", "A", 9_000, 10_000, true, now - 5_000_000_000L);
        eq("clamped to duration", end.positionNow(), 10_000L);
        eq("key ignores case, brackets, punctuation",
            new PlaybackState("ok", "Song Name (feat. X) [Remastered]", "The  Band!", 0, 0, false, 0).key(),
            new PlaybackState("ok", "song name", "the band", 0, 0, false, 0).key());
    }

    static HttpServer server(Map<String, String[]> routes, AtomicInteger hits) throws Exception {
        HttpServer s = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        s.createContext("/", ex -> {
            hits.incrementAndGet();
            String key = ex.getRequestURI().getPath();
            String[] r = routes.get(key);
            if (r == null) { ex.sendResponseHeaders(404, -1); ex.close(); return; }
            byte[] body = r[1].getBytes(StandardCharsets.UTF_8);
            ex.getResponseHeaders().add("Content-Type", "application/json");
            ex.sendResponseHeaders(Integer.parseInt(r[0]), body.length);
            ex.getResponseBody().write(body); ex.close();
        });
        s.start();
        return s;
    }

    static void lrclib() throws Exception {
        Map<String, String[]> routes = new HashMap<>();
        routes.put("/api/get", new String[]{"200", "{\"syncedLyrics\":\"[00:01.00]hi\",\"plainLyrics\":\"hi\"}"});
        AtomicInteger hits = new AtomicInteger();
        HttpServer s = server(routes, hits);
        String base = "http://127.0.0.1:" + s.getAddress().getPort();
        LrcLibClient c = new LrcLibClient(base);
        LrcLibClient.Result r = c.find("Band", "Song", 200_000);
        check("lrclib exact", r != null && !r.hasPlainOnly() && r.syncedLyrics().contains("hi"));

        routes.clear();
        routes.put("/api/search", new String[]{"200", "[{\"duration\":500,\"syncedLyrics\":\"[00:01.00]wrong\"},{\"duration\":200,\"syncedLyrics\":\"[00:01.00]right\"}]"});
        r = c.find("Band", "Song", 200_000);
        check("lrclib search picks matching duration", r != null && r.syncedLyrics().contains("right"));

        routes.clear();
        routes.put("/api/get", new String[]{"200", "{\"plainLyrics\":\"only plain\"}"});
        r = c.find("Band", "Song", 0);
        check("lrclib plain only flagged", r != null && r.hasPlainOnly() && r.syncedLyrics() == null);

        routes.clear();
        check("lrclib nothing -> null", c.find("Band", "Song", 0) == null);

        routes.clear();
        routes.put("/api/get", new String[]{"500", "{}"});
        boolean threw = false;
        try { c.find("Band", "Song", 0); } catch (Exception e) { threw = true; }
        check("lrclib server error throws", threw);
        s.stop(0);
    }

    static final class FakeSource implements MediaSource {
        volatile PlaybackState st = PlaybackState.of("none");
        boolean closed;
        public String name() { return "fake"; }
        public PlaybackState poll() { return st; }
        public void close() { closed = true; }
    }

    static void service() throws Exception {
        Map<String, String[]> routes = new HashMap<>();
        routes.put("/api/get", new String[]{"200", "{\"syncedLyrics\":\"[00:00.00]First\\n[00:10.00]Second\\n[00:20.00]Third\"}"});
        AtomicInteger hits = new AtomicInteger();
        HttpServer srv = server(routes, hits);
        Path tmp = Files.createTempDirectory("starlit-lyrics");
        LyricsStore store = new LyricsStore(tmp.resolve("user"), tmp.resolve("cache"));
        FakeSource src = new FakeSource();
        LyricsService svc = new LyricsService(src, new LrcLibClient("http://127.0.0.1:" + srv.getAddress().getPort()), store);
        svc.start();

        eq("no player", waitStatus(svc, LyricsService.Status.NO_PLAYER), true);
        src.st = new PlaybackState("ok", "Song", "Band", 12_000, 30_000, true, System.nanoTime());
        eq("lyrics ready", waitStatus(svc, LyricsService.Status.READY), true);
        LyricsService.View v = svc.view();
        eq("current line at 12s", v.line(), "Second");
        eq("title exposed", v.title(), "Song");
        long changed = v.lineChangedNanos();

        src.st = new PlaybackState("ok", "Song", "Band", 21_000, 30_000, true, System.nanoTime());
        eq("seek picked up within a poll", waitLine(svc, "Third"), true);
        v = svc.view();
        eq("line advanced after seek", v.line(), "Third");
        eq("previous line remembered", v.previousLine(), "Second");
        check("change time updated", v.lineChangedNanos() > changed);

        src.st = new PlaybackState("ok", "Song", "Band", 21_000, 30_000, false, System.nanoTime());
        eq("paused status", waitStatus(svc, LyricsService.Status.PAUSED), true);
        eq("paused still shows line", svc.view().line(), "Third");

        int before = hits.get();
        src.st = new PlaybackState("ok", "Other", "Band", 1_000, 30_000, true, System.nanoTime());
        eq("new track fetches again", waitStatus(svc, LyricsService.Status.READY), true);
        check("network used for new track", hits.get() > before);
        src.st = new PlaybackState("ok", "Song", "Band", 1_000, 30_000, true, System.nanoTime());
        Thread.sleep(900);
        int afterBack = hits.get();
        eq("back to cached track", waitStatus(svc, LyricsService.Status.READY), true);
        eq("cached lyrics: no extra request", hits.get(), afterBack);

        // user file wins over online/cache
        Files.createDirectories(store.userDir());
        Files.writeString(store.userDir().resolve("Band - Mine.lrc"), "[00:00.00]From my file");
        src.st = new PlaybackState("ok", "Mine", "Band", 500, 30_000, true, System.nanoTime());
        eq("user lrc line", waitLine(svc, "From my file"), true);

        // not found
        routes.clear();
        src.st = new PlaybackState("ok", "Unknown", "Nobody", 500, 30_000, true, System.nanoTime());
        eq("no lyrics status", waitStatus(svc, LyricsService.Status.NO_LYRICS), true);

        // server down -> offline status, no crash
        srv.stop(0);
        src.st = new PlaybackState("ok", "Another", "Band", 500, 30_000, true, System.nanoTime());
        eq("offline status", waitStatus(svc, LyricsService.Status.OFFLINE), true);

        // preview works without any source state
        svc.setPreview(true);
        LyricsService.View pv = svc.view();
        eq("preview status", pv.status(), LyricsService.Status.PREVIEW);
        check("preview shows text", !pv.line().isEmpty());
        svc.setPreview(false);

        Set<Thread> before2 = new HashSet<>(Thread.getAllStackTraces().keySet());
        svc.close();
        Thread.sleep(300);
        check("source closed", src.closed);
        boolean alive = false;
        for (Thread t : Thread.getAllStackTraces().keySet()) if (t.getName().startsWith("starlit-lyrics") && t.isAlive()) alive = true;
        check("service threads stopped on close", !alive);
    }

    static boolean waitLine(LyricsService svc, String want) throws Exception {
        for (int i = 0; i < 60; i++) {
            if (svc.view().line().equals(want)) return true;
            Thread.sleep(100);
        }
        System.out.println("  last line was '" + svc.view().line() + "', wanted '" + want + "'");
        return false;
    }

    static boolean waitStatus(LyricsService svc, LyricsService.Status want) throws Exception {
        for (int i = 0; i < 60; i++) {
            if (svc.view().status() == want) return true;
            Thread.sleep(100);
        }
        System.out.println("  last status was " + svc.view().status() + ", wanted " + want);
        return false;
    }

    static void process() throws Exception {
        if (System.getProperty("os.name").toLowerCase().contains("win")) return;
        ProcessMediaSource ps = new ProcessMediaSource("test", List.of("sh", "-c",
            "while true; do echo '{\"status\":\"ok\",\"title\":\"Song\",\"artist\":\"Band\",\"pos\":2000,\"end\":90000,\"playing\":true}'; sleep 0.1; done"));
        PlaybackState st = PlaybackState.of("none");
        for (int i = 0; i < 40 && !st.hasTrack(); i++) { Thread.sleep(100); st = ps.poll(); }
        check("process source delivers state", st.hasTrack() && st.title().equals("Song"));
        ps.close();
        Thread.sleep(300);
        boolean alive = false;
        for (Thread t : Thread.getAllStackTraces().keySet()) if (t.getName().equals("starlit-media-reader") && t.isAlive()) alive = true;
        check("reader thread ends on close", !alive);
        ProcessMediaSource bad = new ProcessMediaSource("bad", List.of("definitely-not-a-program-xyz"));
        eq("missing helper -> error state, no exception", bad.poll().status(), "error");
        bad.close();
    }

    static void sky() {
        int vanillaDay = 0xFF78A7FF, vanillaNight = 0xFF000008;
        check("daylight day ~1", SkyMath.daylight(vanillaDay) > 0.9f);
        check("daylight night ~0", SkyMath.daylight(vanillaNight) < 0.05f);
        SkyMath.Preset p = SkyMath.PRESETS[0];
        eq("intensity 0 = vanilla", SkyMath.tint(vanillaDay, p.dayZenith(), p.dayHorizon(), p.nightZenith(), p.nightHorizon(), 0.5f, 0f), vanillaDay | 0xFF000000);
        int day = SkyMath.tint(vanillaDay, p.dayZenith(), p.dayHorizon(), p.nightZenith(), p.nightHorizon(), 0f, 1f);
        eq("full intensity day = day zenith", day, p.dayZenith());
        int night = SkyMath.tint(vanillaNight, p.dayZenith(), p.dayHorizon(), p.nightZenith(), p.nightHorizon(), 0f, 1f);
        check("night is dark", ColorMath.luminance(night) < 0.2f);
        int horizon = SkyMath.tint(vanillaDay, p.dayZenith(), p.dayHorizon(), p.nightZenith(), p.nightHorizon(), 1f, 1f);
        eq("gradient 1 = horizon", horizon, p.dayHorizon());
        eq("preset names", SkyMath.presetNames().length, SkyMath.PRESETS.length + 1);
    }

    static void windows() {
        List<String> cmd = WindowsMedia.command();
        eq("powershell used", cmd.get(0), "powershell.exe");
        int i = cmd.indexOf("-EncodedCommand");
        check("encoded command present", i > 0);
        String decoded = new String(Base64.getDecoder().decode(cmd.get(i + 1)), StandardCharsets.UTF_16LE);
        eq("encoded script round-trips", decoded, WindowsMedia.SCRIPT);
        check("no execution policy override", !String.join(" ", cmd).toLowerCase().contains("bypass"));
        check("script reads media sessions", decoded.contains("GlobalSystemMediaTransportControlsSessionManager"));
    }
}
