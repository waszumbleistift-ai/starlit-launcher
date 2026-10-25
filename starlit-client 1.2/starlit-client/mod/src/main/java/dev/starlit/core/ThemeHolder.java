package dev.starlit.core;

import java.nio.file.Files;
import java.nio.file.Path;

/** Holds the active theme and re-reads the launcher's theme file when it changes (checked at most once per second). */
public final class ThemeHolder {
    private final Path file;
    private volatile ThemeData current = ThemeData.defaults();
    private long lastCheckMs;
    private long lastModified = -1;

    public ThemeHolder(Path file) { this.file = file; reloadIfChanged(true); }

    public static ThemeHolder fromSystemProperty() {
        String p = System.getProperty("starlit.theme");
        return new ThemeHolder(p == null || p.isBlank() ? null : Path.of(p));
    }

    public ThemeData get() { return current; }

    /** Cheap enough to call every frame. */
    public ThemeData poll() { reloadIfChanged(false); return current; }

    private void reloadIfChanged(boolean force) {
        if (file == null) return;
        long now = System.currentTimeMillis();
        if (!force && now - lastCheckMs < 1000) return;
        lastCheckMs = now;
        try {
            long m = Files.getLastModifiedTime(file).toMillis();
            if (m != lastModified) { lastModified = m; current = ThemeData.load(file); }
        } catch (Exception ignored) { /* keep the previous theme */ }
    }
}
