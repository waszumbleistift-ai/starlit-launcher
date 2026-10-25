package dev.starlit.module;

import java.util.function.Supplier;

public final class Setting {
    public enum Kind { BOOL, NUMBER, COLOR, ENUM, ACTION, INFO }

    public static final int[] PALETTE = {
        0xFFB44CFF, 0xFFFF6FD8, 0xFF6FA8FF, 0xFF4FE0C4,
        0xFF7CFF6B, 0xFFFFD35C, 0xFFFF6B6B, 0xFFFFFFFF
    };

    public final String key;
    public final String label;
    public final Kind kind;
    public boolean bool;
    public double num, min, max, step;
    public int color;
    public String unit = "";
    public String[] options = new String[0];
    public String buttonLabel = "";
    public Runnable action;
    public Supplier<String> info;

    private Setting(String key, String label, Kind kind) {
        this.key = key;
        this.label = label;
        this.kind = kind;
    }

    public static Setting bool(String key, String label, boolean def) {
        Setting s = new Setting(key, label, Kind.BOOL);
        s.bool = def;
        return s;
    }

    public static Setting number(String key, String label, double def, double min, double max, double step, String unit) {
        Setting s = new Setting(key, label, Kind.NUMBER);
        s.num = def; s.min = min; s.max = max; s.step = step; s.unit = unit;
        return s;
    }

    /** Colour setting. 0 means "follow the launcher theme". */
    public static Setting color(String key, String label, int def) {
        Setting s = new Setting(key, label, Kind.COLOR);
        s.color = def;
        return s;
    }

    /** Dropdown. The selected index is stored in num. */
    public static Setting choice(String key, String label, String[] options, int def) {
        Setting s = new Setting(key, label, Kind.ENUM);
        s.options = options; s.num = def; s.min = 0; s.max = Math.max(0, options.length - 1); s.step = 1;
        return s;
    }

    public static Setting action(String key, String label, String buttonLabel, Runnable action) {
        Setting s = new Setting(key, label, Kind.ACTION);
        s.buttonLabel = buttonLabel; s.action = action;
        return s;
    }

    /** Read-only line (status text). Not saved. */
    public static Setting info(String key, String label, Supplier<String> info) {
        Setting s = new Setting(key, label, Kind.INFO);
        s.info = info;
        return s;
    }

    public boolean persisted() { return kind != Kind.ACTION && kind != Kind.INFO; }

    public int index() { return (int) Math.max(0, Math.min(options.length - 1, Math.round(num))); }

    public void setNumber(double v) {
        double snapped = Math.round(v / step) * step;
        num = Math.max(min, Math.min(max, snapped));
    }
}
