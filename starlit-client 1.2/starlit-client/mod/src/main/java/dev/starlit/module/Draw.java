package dev.starlit.module;

import net.minecraft.client.gui.GuiGraphics;

public final class Draw {
    private Draw() {}

    /** Cheap rounded rectangle built from filled rects (good for radius 2..8). */
    public static void roundRect(GuiGraphics g, int x, int y, int w, int h, int r, int color) {
        if (w <= 0 || h <= 0) return;
        r = Math.max(0, Math.min(r, Math.min(w, h) / 2));
        if (r == 0) { g.fill(x, y, x + w, y + h, color); return; }
        g.fill(x + r, y, x + w - r, y + h, color);
        g.fill(x, y + r, x + r, y + h - r, color);
        g.fill(x + w - r, y + r, x + w, y + h - r, color);
        for (int i = 1; i < r; i++) {
            int inset = r - i;
            g.fill(x + inset, y + i, x + r, y + i + 1, color);
            g.fill(x + w - r, y + i, x + w - inset, y + i + 1, color);
            g.fill(x + inset, y + h - i - 1, x + r, y + h - i, color);
            g.fill(x + w - r, y + h - i - 1, x + w - inset, y + h - i, color);
        }
    }

    public static int withAlpha(int argb, int alpha) {
        return (alpha << 24) | (argb & 0x00FFFFFF);
    }
}
