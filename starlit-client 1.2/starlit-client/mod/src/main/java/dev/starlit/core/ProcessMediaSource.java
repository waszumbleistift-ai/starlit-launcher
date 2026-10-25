package dev.starlit.core;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * Runs a helper process that prints one JSON line per update and exposes the newest line as a PlaybackState.
 * The process is created lazily and destroyed in close(), so a disabled module holds no resources.
 * If no line arrived for 4 seconds the state turns to "none" (player closed, script died).
 */
public final class ProcessMediaSource implements MediaSource {
    private final String name;
    private final List<String> command;
    private Process process;
    private Thread reader;
    private volatile PlaybackState latest = PlaybackState.of(PlaybackState.NONE);
    private volatile long lastLineNanos;
    private volatile boolean closed;

    public ProcessMediaSource(String name, List<String> command) { this.name = name; this.command = command; }

    @Override public String name() { return name; }

    public synchronized void start() {
        if (process != null || closed) return;
        try {
            process = new ProcessBuilder(command).redirectErrorStream(false).start();
            lastLineNanos = System.nanoTime();
            final Process p = process;
            reader = new Thread(() -> {
                try (BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while (!closed && (line = r.readLine()) != null) {
                        line = line.strip();
                        if (!line.startsWith("{")) continue;
                        latest = SmtcParser.parse(line, System.nanoTime());
                        lastLineNanos = System.nanoTime();
                    }
                } catch (Exception ignored) { /* process ended */ }
                if (!closed) latest = PlaybackState.of(PlaybackState.ERROR);
            }, "starlit-media-reader");
            reader.setDaemon(true);
            reader.start();
        } catch (Exception e) {
            latest = PlaybackState.of(PlaybackState.ERROR);
        }
    }

    @Override public PlaybackState poll() {
        start();
        if (System.nanoTime() - lastLineNanos > 4_000_000_000L && process != null && process.isAlive()) return PlaybackState.of(PlaybackState.NONE);
        return latest;
    }

    @Override public synchronized void close() {
        closed = true;
        if (process != null) { process.destroyForcibly(); process = null; }
        if (reader != null) { reader.interrupt(); reader = null; }
    }
}
