package dev.starlit.core;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Parser for synchronised .lrc lyrics ("[mm:ss.xx] text", several stamps per line, [offset:] tag). */
public final class LrcParser {
    public record Line(long timeMs, String text) {}

    private static final Pattern STAMP = Pattern.compile("\\[(\\d{1,3}):(\\d{1,2})(?:[.:](\\d{1,3}))?]");
    private static final Pattern OFFSET = Pattern.compile("^\\[offset:\\s*([+-]?\\d+)\\s*]", Pattern.CASE_INSENSITIVE);
    private static final Pattern WORD_STAMP = Pattern.compile("<\\d{1,3}:\\d{1,2}(?:[.:]\\d{1,3})?>");

    private LrcParser() {}

    public static List<Line> parse(String lrc) {
        List<Line> out = new ArrayList<>();
        if (lrc == null) return out;
        long offset = 0;
        for (String raw : lrc.split("\\r?\\n")) {
            String line = raw.strip();
            if (line.startsWith("﻿")) line = line.substring(1);
            Matcher o = OFFSET.matcher(line);
            if (o.find()) { offset = Long.parseLong(o.group(1)); continue; }
            Matcher m = STAMP.matcher(line);
            List<Long> times = new ArrayList<>();
            int end = 0;
            while (m.find() && m.start() == end) {
                long mins = Long.parseLong(m.group(1)), secs = Long.parseLong(m.group(2));
                String frac = m.group(3);
                long ms = 0;
                if (frac != null) ms = Long.parseLong((frac + "00").substring(0, 3));
                times.add(mins * 60_000 + secs * 1000 + ms);
                end = m.end();
            }
            if (times.isEmpty()) continue; // metadata tag or junk
            String text = WORD_STAMP.matcher(line.substring(end)).replaceAll("").strip();
            for (long t : times) out.add(new Line(t, text));
        }
        // a positive offset shows lyrics earlier (LRC specification)
        if (offset != 0) {
            List<Line> shifted = new ArrayList<>(out.size());
            for (Line l : out) shifted.add(new Line(Math.max(0, l.timeMs() - offset), l.text()));
            out = shifted;
        }
        out.sort(Comparator.comparingLong(Line::timeMs));
        return out;
    }

    /** Index of the last line whose time is <= positionMs, or -1 before the first line. */
    public static int indexAt(List<Line> lines, long positionMs) {
        int lo = 0, hi = lines.size() - 1, ans = -1;
        while (lo <= hi) {
            int mid = (lo + hi) >>> 1;
            if (lines.get(mid).timeMs() <= positionMs) { ans = mid; lo = mid + 1; } else hi = mid - 1;
        }
        return ans;
    }
}
