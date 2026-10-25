package dev.starlit.core;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.stream.Stream;

/** Disk cache for downloaded lyrics plus the user's own .lrc files ("Artist - Title.lrc" in the lyrics folder). */
public final class LyricsStore {
    private final Path cacheDir;
    private final Path userDir;

    public LyricsStore(Path userDir, Path cacheDir) { this.userDir = userDir; this.cacheDir = cacheDir; }

    public Path userDir() { return userDir; }

    private static String hash(String key) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-1").digest(key.getBytes(StandardCharsets.UTF_8));
            StringBuilder b = new StringBuilder();
            for (byte x : d) b.append(String.format("%02x", x));
            return b.toString();
        } catch (Exception e) { throw new IllegalStateException(e); }
    }

    public String cached(String key) {
        try { return Files.readString(cacheDir.resolve(hash(key) + ".lrc")); } catch (IOException e) { return null; }
    }

    public void cache(String key, String lrc) {
        try { Files.createDirectories(cacheDir); Files.writeString(cacheDir.resolve(hash(key) + ".lrc"), lrc); } catch (IOException ignored) { /* cache is optional */ }
    }

    /** Looks for "<artist> - <title>.lrc" or "<title>.lrc" (case/punctuation-insensitive). */
    public String userFile(PlaybackState st) {
        if (userDir == null || !Files.isDirectory(userDir)) return null;
        String both = PlaybackState.normalize(st.artist() + " " + st.title());
        String onlyTitle = PlaybackState.normalize(st.title());
        try (Stream<Path> files = Files.list(userDir)) {
            for (Path p : (Iterable<Path>) files::iterator) {
                String n = p.getFileName().toString();
                if (!n.toLowerCase().endsWith(".lrc")) continue;
                String base = PlaybackState.normalize(n.substring(0, n.length() - 4));
                if (base.equals(both) || base.equals(onlyTitle)) return Files.readString(p);
            }
        } catch (IOException ignored) { /* treat as not found */ }
        return null;
    }
}
