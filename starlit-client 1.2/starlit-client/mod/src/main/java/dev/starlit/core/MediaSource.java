package dev.starlit.core;

/** Where "what is playing right now" comes from. Implementations must never block the caller for long. */
public interface MediaSource extends AutoCloseable {
    String name();
    /** Latest known state (cheap, non-blocking). */
    PlaybackState poll();
    @Override void close();
}
