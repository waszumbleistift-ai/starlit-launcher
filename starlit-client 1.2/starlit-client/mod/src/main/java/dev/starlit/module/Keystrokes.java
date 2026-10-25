package dev.starlit.module;

import dev.starlit.Starlit;
import dev.starlit.core.ColorMath;
import dev.starlit.core.ThemeData;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;

public class Keystrokes extends Module {
    public Keystrokes() {
        super("keystrokes", "Keystrokes", "WASD and jump, lit up as you press.", Category.HUD);
        add(Setting.number("x", "Horizontal", 0, 0, 100, 1, "%"));
        add(Setting.number("y", "Vertical", 100, 0, 100, 1, "%"));
        add(Setting.color("colour", "Colour", 0));
    }

    @Override
    public void renderHud(GuiGraphics g, Minecraft mc) {
        int k = 22, gap = 2;
        int w = k * 3 + gap * 2, h = k * 2 + gap * 2 + 12;
        int px = (int) ((g.guiWidth() - w) * get("x").num / 100.0);
        int py = (int) ((g.guiHeight() - h) * get("y").num / 100.0);
        int col = Starlit.resolve(get("colour").color);
        key(g, mc, px + k + gap, py, k, k, "W", mc.options.keyUp, col);
        key(g, mc, px, py + k + gap, k, k, "A", mc.options.keyLeft, col);
        key(g, mc, px + k + gap, py + k + gap, k, k, "S", mc.options.keyDown, col);
        key(g, mc, px + 2 * (k + gap), py + k + gap, k, k, "D", mc.options.keyRight, col);
        key(g, mc, px, py + 2 * (k + gap), w, 12, "JUMP", mc.options.keyJump, col);
    }

    private static void key(GuiGraphics g, Minecraft mc, int x, int y, int w, int h, String label, KeyMapping km, int col) {
        ThemeData th = Starlit.theme();
        boolean down = km.isDown();
        Draw.roundRect(g, x, y, w, h, 3, down ? ColorMath.withAlpha(col, 0xD8) : Starlit.panelColor(0.78f));
        int tx = x + (w - mc.font.width(label)) / 2;
        int ty = y + (h - mc.font.lineHeight) / 2 + 1;
        g.drawString(mc.font, label, tx, ty, down ? th.onPrimary : th.text, false);
    }
}
