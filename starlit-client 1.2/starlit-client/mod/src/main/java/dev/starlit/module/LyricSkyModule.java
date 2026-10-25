package dev.starlit.module;

import dev.starlit.Starlit;
import dev.starlit.core.*;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * LyricSky: shows the lyrics of the song you are listening to as soft floating text above the crosshair.
 * Purely visual and client-side. The text is drawn in screen space with depth cues (size, opacity, slow bobbing),
 * so it never interacts with the world or other players.
 */
public final class LyricSkyModule extends Module {
    private static final String[] SOURCES = {"Windows media session", "Preview text only"};

    private LyricsService service;
    private int runningSource = -1;
    private boolean runningOnline;

    public LyricSkyModule() {
        super("lyricsky", "LyricSky", "Lyrics of your current song, floating in the air.", Category.VISUAL);
        add(Setting.info("status", "Status", () -> statusText()));
        add(Setting.info("track", "Now playing", () -> trackText()));
        add(Setting.choice("source", "Music source", SOURCES, WindowsMedia.supported() ? 0 : 1));
        add(Setting.bool("online", "Download lyrics (LRCLIB)", true));
        add(Setting.action("folder", "Own .lrc files", "Open folder", LyricSkyModule::openFolder));
        add(Setting.number("x", "Horizontal", 50, 0, 100, 1, "%"));
        add(Setting.number("y", "Height", 32, 0, 100, 1, "%"));
        add(Setting.number("distance", "Distance", 3, 1, 10, 1, ""));
        add(Setting.number("size", "Text size", 100, 50, 300, 5, "%"));
        add(Setting.number("opacity", "Opacity", 90, 10, 100, 5, "%"));
        add(Setting.color("colour", "Text colour", 0));
        add(Setting.bool("shadow", "Shadow", true));
        add(Setting.bool("glow", "Glow", true));
        add(Setting.bool("animations", "Animations", true));
        add(Setting.bool("showTitle", "Show title and artist", true));
        add(Setting.number("sync", "Sync offset", 0, -3000, 3000, 50, " ms"));
        add(Setting.bool("preview", "Preview text", false));
    }

    private static Path baseDir() { return FabricLoader.getInstance().getConfigDir().resolve("starlit"); }
    private static Path lyricsDir() { return baseDir().resolve("lyrics"); }

    private static void openFolder() {
        try {
            Files.createDirectories(lyricsDir());
            String os = System.getProperty("os.name", "").toLowerCase();
            String cmd = os.contains("win") ? "explorer.exe" : os.contains("mac") ? "open" : "xdg-open";
            new ProcessBuilder(cmd, lyricsDir().toString()).start();
        } catch (Exception ignored) { /* nothing sensible to do */ }
    }

    private String statusText() {
        if (service == null) return "Module is off";
        LyricsService.View v = service.view();
        return LyricsService.message(v.status());
    }

    private String trackText() {
        if (service == null) return "-";
        LyricsService.View v = service.view();
        return v.title() == null || v.title().isBlank() ? "-" : v.artist() + " - " + v.title();
    }

    @Override protected void onEnable() { /* the service starts lazily on the first frame */ }

    @Override protected void onDisable() { stop(); }

    private void stop() {
        if (service != null) { service.close(); service = null; }
        runningSource = -1;
    }

    private void ensureService() {
        int src = get("source").index();
        boolean online = get("online").bool;
        if (service != null && src == runningSource && online == runningOnline) return;
        stop();
        MediaSource ms = (src == 0 && WindowsMedia.supported()) ? WindowsMedia.create() : null;
        LyricsStore store = new LyricsStore(lyricsDir(), baseDir().resolve("lyrics-cache"));
        service = new LyricsService(ms, online ? new LrcLibClient() : null, store);
        service.start();
        runningSource = src;
        runningOnline = online;
    }

    @Override
    public void renderHud(GuiGraphics g, Minecraft mc) {
        ensureService();
        service.setPreview(get("preview").bool || get("source").index() == 1);
        service.setOffsetMs((long) get("sync").num);
        LyricsService.View v = service.view();
        boolean animate = get("animations").bool;
        long now = System.nanoTime();
        float t = (now - v.lineChangedNanos()) / 1_000_000_000f;

        int accent = Starlit.resolve(get("colour").color);
        ThemeData th = Starlit.theme();
        float dist = (float) get("distance").num;
        float depth = 1.25f - 0.05f * dist;                       // farther = smaller
        float baseAlpha = (float) get("opacity").num / 100f * (1.1f - 0.04f * dist);
        float scale = 2.0f * (float) get("size").num / 100f * depth;
        int cx = (int) (g.guiWidth() * get("x").num / 100.0);
        int cy = (int) (g.guiHeight() * get("y").num / 100.0);
        float bob = animate ? (float) Math.sin(now / 1_000_000_000.0 * 1.1) * 1.6f : 0f;

        boolean showStatus = v.line().isEmpty() && v.status() != LyricsService.Status.READY
            && v.status() != LyricsService.Status.PAUSED && v.status() != LyricsService.Status.PREVIEW;
        float fadeIn = animate ? ease(Math.min(1f, t / 0.35f)) : 1f;

        if (animate && t < 0.25f && !v.previousLine().isEmpty()) {
            drawLine(g, mc, v.previousLine(), cx, cy + bob - 8 * ease(t / 0.25f), scale, accent, th, baseAlpha * (1f - t / 0.25f));
        }
        if (!v.line().isEmpty()) {
            drawLine(g, mc, v.line(), cx, cy + bob + (animate ? 6 * (1f - fadeIn) : 0), scale, accent, th, baseAlpha * fadeIn);
        } else if (showStatus) {
            drawLine(g, mc, LyricsService.message(v.status()), cx, cy + bob, scale * 0.5f, th.muted, th, baseAlpha * 0.7f);
        }
        if (get("showTitle").bool && v.title() != null && !v.title().isBlank()) {
            drawLine(g, mc, v.artist().isBlank() ? v.title() : v.artist() + " - " + v.title(), cx, cy + bob + 22 * scale / 2f + 10, scale * 0.38f, th.muted, th, baseAlpha * 0.65f);
        }
    }

    private static float ease(float x) { x = Math.max(0f, Math.min(1f, x)); return 1f - (1f - x) * (1f - x) * (1f - x); }

    private void drawLine(GuiGraphics g, Minecraft mc, String text, float cx, float cy, float scale, int color, ThemeData th, float alpha) {
        if (alpha <= 0.02f) return;
        int maxPx = (int) (g.guiWidth() * 0.78f / scale);
        List<String> rows = wrap(mc, text, maxPx);
        int lh = mc.font.lineHeight + 2;
        float top = -rows.size() * lh / 2f;
        boolean glow = get("glow").bool, shadow = get("shadow").bool;
        g.pose().pushMatrix();
        g.pose().translate(cx, cy);
        g.pose().scale(scale, scale);
        for (int i = 0; i < rows.size(); i++) {
            String row = rows.get(i);
            int x = -mc.font.width(row) / 2;
            int y = (int) (top + i * lh);
            if (glow) {
                int gc = ColorMath.scaleAlpha(ColorMath.withAlpha(th.accent, 255), alpha * 0.16f);
                for (int[] d : new int[][]{{-1, 0}, {1, 0}, {0, -1}, {0, 1}}) g.drawString(mc.font, row, x + d[0], y + d[1], gc, false);
            }
            g.drawString(mc.font, row, x, y, ColorMath.scaleAlpha(color | 0xFF000000, alpha), shadow);
        }
        g.pose().popMatrix();
    }

    private static List<String> wrap(Minecraft mc, String text, int maxPx) {
        List<String> rows = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        for (String word : text.split(" ")) {
            String tryLine = cur.isEmpty() ? word : cur + " " + word;
            if (mc.font.width(tryLine) > maxPx && !cur.isEmpty()) { rows.add(cur.toString()); cur = new StringBuilder(word); }
            else { cur = new StringBuilder(tryLine); }
        }
        if (!cur.isEmpty()) rows.add(cur.toString());
        return rows;
    }
}
