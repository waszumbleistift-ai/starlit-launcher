package dev.starlit.module;

import dev.starlit.Starlit;
import dev.starlit.core.ColorMath;
import dev.starlit.core.ThemeData;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;

import java.util.List;
import java.util.function.Function;

/** A text widget: a rounded box with one or more lines, placed by X/Y percent, coloured by the launcher theme. */
public class HudModule extends Module {
    private final Function<Minecraft, List<String>> lines;

    public HudModule(String id, String name, String desc, int x, int y, Function<Minecraft, List<String>> lines) {
        super(id, name, desc, Category.HUD);
        this.lines = lines;
        add(Setting.number("x", "Horizontal", x, 0, 100, 1, "%"));
        add(Setting.number("y", "Vertical", y, 0, 100, 1, "%"));
        add(Setting.bool("background", "Background", true));
        add(Setting.bool("shadow", "Text shadow", true));
        add(Setting.color("colour", "Colour", 0));
    }

    @Override
    public void renderHud(GuiGraphics g, Minecraft mc) {
        List<String> ls = lines.apply(mc);
        if (ls == null || ls.isEmpty()) return;
        ThemeData th = Starlit.theme();
        int w = 0;
        for (String l : ls) w = Math.max(w, mc.font.width(l));
        int lineH = mc.font.lineHeight + 2;
        int boxW = w + 14, boxH = ls.size() * lineH + 8;
        int px = (int) ((g.guiWidth() - boxW) * get("x").num / 100.0);
        int py = (int) ((g.guiHeight() - boxH) * get("y").num / 100.0);
        int accent = Starlit.resolve(get("colour").color);
        if (get("background").bool) {
            Draw.roundRect(g, px, py, boxW, boxH, 4, Starlit.panelColor(0.78f));
            Draw.roundRect(g, px, py + 3, 2, boxH - 6, 1, accent);
        }
        boolean shadow = get("shadow").bool;
        for (int i = 0; i < ls.size(); i++) {
            g.drawString(mc.font, ls.get(i), px + 8, py + 5 + i * lineH, i == 0 ? th.text : ColorMath.mix(th.text, accent, 0.6f), shadow);
        }
    }
}
