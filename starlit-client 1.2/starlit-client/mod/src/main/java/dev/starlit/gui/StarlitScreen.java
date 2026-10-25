package dev.starlit.gui;

import dev.starlit.Starlit;
import dev.starlit.StarlitMod;
import dev.starlit.core.ColorMath;
import dev.starlit.core.ThemeData;
import dev.starlit.module.Category;
import dev.starlit.module.Draw;
import dev.starlit.module.Module;
import dev.starlit.module.ModuleManager;
import dev.starlit.module.Setting;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;
import org.lwjgl.glfw.GLFW;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.DoubleConsumer;

/** The Starlit menu. Colours come from the launcher theme; hover, toggles, open/close and sliders are animated. */
public class StarlitScreen extends Screen {
    private int W = 480, H = 330;
    private static final int CARD_H = 46, GAP = 8;

    private record Hit(int x, int y, int w, int h, Runnable left, Runnable right, DoubleConsumer drag) {
        boolean in(double mx, double my) { return mx >= x && mx < x + w && my >= y && my < y + h; }
    }

    private final List<Hit> hits = new ArrayList<>();
    private final Map<String, Float> anim = new HashMap<>();
    private Category tab = Category.HUD;
    private Module open;
    private Setting dropdown;
    private int dropX, dropY, dropW;
    private int scroll, maxScroll, panelScroll, panelMaxScroll;
    private String status = "";
    private DoubleConsumer dragging;
    private long lastNanos = System.nanoTime();
    private float dt;
    private float fade = 0f;
    private ThemeData th;

    public StarlitScreen() {
        super(Component.literal("Starlit"));
    }

    @Override public boolean isPauseScreen() { return false; }

    @Override
    public void onClose() {
        ModuleManager.save();
        super.onClose();
    }

    // ------------------------------------------------------------------ helpers

    /** Eases a named value towards a target. Used for hover, toggle and fade animations. */
    private float a(String key, float target, float speed, float initial) {
        float cur = anim.getOrDefault(key, initial);
        cur += (target - cur) * Math.min(1f, dt * speed);
        if (Math.abs(target - cur) < 0.002f) cur = target;
        anim.put(key, cur);
        return cur;
    }

    private float a(String key, float target) { return a(key, target, 14f, target); }

    private int c(int argb) { return ColorMath.scaleAlpha(argb, fade); }

    private int glass(float strength) { return c(ColorMath.withAlpha(th.button, Math.round(10 + 40 * strength))); }

    private boolean textFits(String s, int w) { return font.width(s) <= w; }

    private void text(GuiGraphics g, String s, int x, int y, int color) { g.drawString(font, s, x, y, c(color), false); }

    // dim the world only lightly so Sky changes can be judged while the menu is open (no override annotation: silently ignored if the signature differs)
    public void renderBackground(GuiGraphics g, int mx, int my, float delta) {
        int a = (open != null && open.id.equals("sky")) ? 0x26 : 0x70;
        g.fill(0, 0, width, height, ColorMath.withAlpha(0x000000, Math.round(a * Math.min(1f, fade))));
    }

    // ------------------------------------------------------------------ render

    @Override
    public void render(GuiGraphics g, int mx, int my, float delta) {
        long now = System.nanoTime();
        dt = Math.min(0.05f, (now - lastNanos) / 1_000_000_000f);
        lastNanos = now;
        th = Starlit.theme();
        fade = a("open", 1f, 9f, 0f);
        super.render(g, mx, my, delta);
        hits.clear();
        int accent = ModuleManager.accentColor();

        W = Math.max(300, Math.min(480, width - 16));
        H = Math.max(190, Math.min(330, height - 16));
        int x0 = (width - W) / 2, y0 = (height - H) / 2 + Math.round((1f - fade) * 8);

        // panel with a soft glow frame that follows the theme
        int glowA = Math.round(70 * th.glow);
        Draw.roundRect(g, x0 - 2, y0 - 2, W + 4, H + 4, 9, c(ColorMath.withAlpha(accent, glowA)));
        Draw.roundRect(g, x0 - 1, y0 - 1, W + 2, H + 2, 8, c(ColorMath.withAlpha(th.border, 40)));
        Draw.roundRect(g, x0, y0, W, H, 7, c(ColorMath.withAlpha(th.panel, 0xF2)));

        // header
        Draw.roundRect(g, x0 + 16, y0 + 12, 16, 16, 5, c(accent));
        g.drawString(font, "S", x0 + 21, y0 + 16, c(th.onPrimary), false);
        g.drawString(font, "STARLIT", x0 + 38, y0 + 16, c(th.text), true);
        String count = ModuleManager.activeCount() + " of " + ModuleManager.MODULES.size() + " active";
        text(g, count, x0 + W - 18 - font.width(count), y0 + 16, th.muted);

        // tabs
        int tx = x0 + 18;
        for (Category cat : Category.values()) {
            int tw = font.width(cat.label) + 22;
            boolean sel = cat == tab;
            boolean hover = open == null && mx >= tx && mx < tx + tw && my >= y0 + 34 && my < y0 + 52;
            float h = a("tab:" + cat, hover ? 1f : 0f);
            Draw.roundRect(g, tx, y0 + 34, tw, 18, 9, sel ? c(accent) : glass(h * 0.6f));
            text(g, cat.label, tx + 11, y0 + 39, sel ? th.onPrimary : th.text);
            final Category cc = cat;
            if (open == null) hits.add(new Hit(tx, y0 + 34, tw, 18, () -> { tab = cc; scroll = 0; }, null, null));
            tx += tw + 6;
        }
        text(g, tab.blurb, x0 + 18, y0 + 60, th.muted);

        // module grid
        int viewTop = y0 + 76, viewBottom = y0 + H - 44;
        int cardW = (W - 36 - GAP) / 2;
        List<Module> mods = new ArrayList<>();
        for (Module m : ModuleManager.MODULES) if (m.category == tab) mods.add(m);
        int rows = (mods.size() + 1) / 2;
        maxScroll = Math.max(0, rows * (CARD_H + GAP) - GAP - (viewBottom - viewTop));
        scroll = Math.max(0, Math.min(scroll, maxScroll));

        g.enableScissor(x0, viewTop, x0 + W, viewBottom);
        for (int i = 0; i < mods.size(); i++) {
            Module m = mods.get(i);
            int cx = x0 + 18 + (i % 2) * (cardW + GAP);
            int cy = viewTop + (i / 2) * (CARD_H + GAP) - scroll;
            if (cy + CARD_H < viewTop || cy > viewBottom) continue;
            boolean hover = open == null && mx >= cx && mx < cx + cardW && my >= cy && my < cy + CARD_H && my >= viewTop && my < viewBottom;
            float h = a("card:" + m.id, hover ? 1f : 0f);
            float on = a("on:" + m.id, m.enabled ? 1f : 0f, 12f, m.enabled ? 1f : 0f);
            if (on > 0.01f) Draw.roundRect(g, cx - 1, cy - 1, cardW + 2, CARD_H + 2, 7, c(ColorMath.withAlpha(accent, Math.round(on * (50 + 60 * th.glow)))));
            Draw.roundRect(g, cx, cy, cardW, CARD_H, 6, glass(h));
            text(g, m.name, cx + 12, cy + 12, th.text);
            text(g, font.plainSubstrByWidth(m.description, cardW - 70), cx + 12, cy + 26, th.muted);
            toggle(g, cx + cardW - 40, cy + 12, on, accent);
            if (open == null) {
                int hy = Math.max(cy, viewTop);
                hits.add(new Hit(cx, hy, cardW, Math.min(CARD_H, viewBottom - hy),
                    () -> { m.setEnabled(!m.enabled); ModuleManager.save(); }, () -> open = m, null));
            }
        }
        g.disableScissor();

        // footer
        int fy = y0 + H - 34;
        button(g, x0 + 18, fy, 100, 20, "Copy config", accent, () -> {
            minecraft.keyboardHandler.setClipboard(ModuleManager.exportCode());
            status = "Config code copied";
        });
        button(g, x0 + 124, fy, 100, 20, "Paste config", accent, () -> {
            status = ModuleManager.importCode(minecraft.keyboardHandler.getClipboard()) ? "Config imported" : "Clipboard has no Starlit code";
        });
        int sx = x0 + 232;
        text(g, font.plainSubstrByWidth(status, Math.max(20, x0 + W - 18 - sx)), sx, fy + 6, th.muted);
        if (status.isEmpty() && W >= 480) {
            String hint = "Right-click for settings";
            text(g, hint, x0 + W - 18 - font.width(hint), fy + 6, th.muted);
        }

        float overlay = a("overlay", open != null ? 1f : 0f, 14f, 0f);
        if (open != null || overlay > 0.01f) renderSettings(g, accent, mx, my, overlay);
    }

    private int rowHeight(Setting s) { return s.kind == Setting.Kind.INFO ? 40 : 28; }

    private void renderSettings(GuiGraphics g, int accent, int mx, int my, float overlay) {
        if (open == null) return;
        Module m = open;
        float f = fade * overlay;
        g.fill(0, 0, width, height, ColorMath.withAlpha(0x000000, Math.round(0x70 * f)));
        int pw = Math.max(290, Math.min(340, width - 16));
        int content = 0;
        for (Setting s : m.settings) content += rowHeight(s);
        int headerH = 84, footerH = 40;
        int ph = Math.min(height - 16, headerH + content + footerH);
        int px = (width - pw) / 2, py = (height - ph) / 2 + Math.round((1f - overlay) * 10);
        int areaTop = py + headerH, areaBottom = py + ph - footerH;
        panelMaxScroll = Math.max(0, content - (areaBottom - areaTop));
        panelScroll = Math.max(0, Math.min(panelScroll, panelMaxScroll));

        Draw.roundRect(g, px - 1, py - 1, pw + 2, ph + 2, 8, ColorMath.scaleAlpha(ColorMath.withAlpha(accent, Math.round(90 * th.glow) + 30), f));
        Draw.roundRect(g, px, py, pw, ph, 7, ColorMath.scaleAlpha(ColorMath.withAlpha(th.panel, 0xFA), f));
        hits.add(new Hit(px, py, pw, ph, () -> {}, () -> {}, null)); // swallow clicks inside the panel

        float prev = fade; fade = f;
        text(g, m.name, px + 18, py + 16, th.text);
        text(g, font.plainSubstrByWidth(m.description, pw - 36), px + 18, py + 30, th.muted);

        int ry = py + 50;
        text(g, "Enabled", px + 18, ry + 8, th.text);
        float on = a("pon:" + m.id, m.enabled ? 1f : 0f, 12f, m.enabled ? 1f : 0f);
        toggle(g, px + pw - 56, ry + 6, on, accent);
        hits.add(new Hit(px + pw - 60, ry, 46, 24, () -> m.setEnabled(!m.enabled), null, null));
        g.fill(px + 14, py + headerH - 6, px + pw - 14, py + headerH - 5, c(ColorMath.withAlpha(th.border, 30)));

        g.enableScissor(px, areaTop, px + pw, areaBottom);
        int y = areaTop - panelScroll;
        Setting openDrop = null;
        for (Setting s : m.settings) {
            int rh = rowHeight(s);
            boolean visible = y + rh > areaTop && y < areaBottom;
            if (visible) {
                text(g, s.label, px + 18, y + 8, th.text);
                int cy = y + 4;
                switch (s.kind) {
                    case BOOL -> {
                        float t = a("s:" + m.id + s.key, s.bool ? 1f : 0f, 12f, s.bool ? 1f : 0f);
                        toggle(g, px + pw - 56, cy + 2, t, accent);
                        addIn(areaTop, areaBottom, new Hit(px + pw - 60, cy, 46, 22, () -> s.bool = !s.bool, null, null));
                    }
                    case NUMBER -> {
                        int sx = px + 150, sw = pw - 150 - 18 - 58;
                        double t = (s.num - s.min) / (s.max - s.min);
                        Draw.roundRect(g, sx, cy + 8, sw, 4, 2, c(ColorMath.withAlpha(th.off, 60)));
                        Draw.roundRect(g, sx, cy + 8, Math.max(2, (int) (sw * t)), 4, 2, c(accent));
                        Draw.roundRect(g, sx + (int) (sw * t) - 4, cy + 4, 8, 12, 4, c(th.text));
                        String v = (s.step < 1 ? String.format("%.1f", s.num) : String.valueOf((int) s.num)) + s.unit;
                        text(g, v, px + pw - 18 - font.width(v), cy + 6, th.muted);
                        DoubleConsumer drag = mxv -> s.setNumber(s.min + Math.max(0, Math.min(1, (mxv - sx) / sw)) * (s.max - s.min));
                        addIn(areaTop, areaBottom, new Hit(sx - 6, cy, sw + 12, 22, null, null, drag));
                    }
                    case COLOR -> {
                        int n = Setting.PALETTE.length + 1;
                        int sx = px + pw - 18 - n * 16;
                        for (int i = 0; i < n; i++) {
                            int val = i == 0 ? 0 : Setting.PALETTE[i - 1];
                            int shown = i == 0 ? th.primary : val;
                            int bx = sx + i * 16;
                            if (s.color == val) Draw.roundRect(g, bx - 1, cy + 3, 14, 14, 4, c(th.text));
                            Draw.roundRect(g, bx, cy + 4, 12, 12, 3, c(shown));
                            if (i == 0) g.fill(bx + 5, cy + 9, bx + 7, cy + 11, c(th.onPrimary));
                            addIn(areaTop, areaBottom, new Hit(bx, cy + 3, 14, 14, () -> s.color = val, null, null));
                        }
                    }
                    case ENUM -> {
                        int bw = 126, bx = px + pw - 18 - bw;
                        boolean isOpen = dropdown == s;
                        Draw.roundRect(g, bx, cy, bw, 20, 6, glass(isOpen ? 0.8f : 0.3f));
                        text(g, font.plainSubstrByWidth(s.options[s.index()], bw - 22), bx + 8, cy + 6, th.text);
                        text(g, isOpen ? "^" : "v", bx + bw - 14, cy + 6, th.muted);
                        if (isOpen) { openDrop = s; dropX = bx; dropY = cy + 22; dropW = bw; }
                        addIn(areaTop, areaBottom, new Hit(bx, cy, bw, 20, () -> dropdown = isOpen ? null : s, null, null));
                    }
                    case ACTION -> {
                        int bw = font.width(s.buttonLabel) + 22, bx = px + pw - 18 - bw;
                        Draw.roundRect(g, bx, cy, bw, 20, 6, c(ColorMath.withAlpha(accent, 0x70)));
                        text(g, s.buttonLabel, bx + 11, cy + 6, th.text);
                        addIn(areaTop, areaBottom, new Hit(bx, cy, bw, 20, s.action, null, null));
                    }
                    case INFO -> {
                        String v = s.info.get();
                        text(g, font.plainSubstrByWidth(v, pw - 36), px + 18, y + 22, th.muted);
                    }
                }
            }
            y += rh;
        }
        g.disableScissor();

        // dropdown list drawn last so it sits above everything
        if (dropdown != null && openDrop == dropdown) {
            Setting s = dropdown;
            int ih = 18, listH = s.options.length * ih + 4;
            Draw.roundRect(g, dropX - 1, dropY - 1, dropW + 2, listH + 2, 6, c(ColorMath.withAlpha(th.border, 60)));
            Draw.roundRect(g, dropX, dropY, dropW, listH, 5, c(ColorMath.withAlpha(th.panel, 0xFF)));
            for (int i = 0; i < s.options.length; i++) {
                int iy = dropY + 2 + i * ih;
                boolean hov = mx >= dropX && mx < dropX + dropW && my >= iy && my < iy + ih;
                if (hov || i == s.index()) Draw.roundRect(g, dropX + 2, iy, dropW - 4, ih, 4, c(ColorMath.withAlpha(accent, i == s.index() ? 0x90 : 0x45)));
                text(g, font.plainSubstrByWidth(s.options[i], dropW - 14), dropX + 8, iy + 5, i == s.index() ? th.onPrimary : th.text);
                final int idx = i;
                hits.add(new Hit(dropX, iy, dropW, ih, () -> { s.setNumber(idx); dropdown = null; }, null, null));
            }
        }

        g.fill(px + 14, areaBottom + 2, px + pw - 14, areaBottom + 3, c(ColorMath.withAlpha(th.border, 30)));
        button(g, px + 18, py + ph - 32, 118, 20, "Reset to defaults", accent, () -> { ModuleManager.resetModule(m); dropdown = null; });
        button(g, px + pw - 78, py + ph - 32, 60, 20, "Done", accent, () -> { open = null; dropdown = null; ModuleManager.save(); });
        fade = prev;
    }

    private void addIn(int top, int bottom, Hit h) {
        if (h.y() + h.h() > top && h.y() < bottom) hits.add(h);
    }

    private void toggle(GuiGraphics g, int x, int y, float t, int accent) {
        Draw.roundRect(g, x, y, 30, 16, 8, c(ColorMath.mix(ColorMath.withAlpha(th.off, 56), th.on, t)));
        Draw.roundRect(g, x + 2 + Math.round(14 * t), y + 2, 12, 12, 6, c(th.text));
    }

    private void button(GuiGraphics g, int x, int y, int w, int h, String label, int accent, Runnable action) {
        Draw.roundRect(g, x, y, w, h, 6, c(ColorMath.withAlpha(accent, 0x70)));
        text(g, label, x + (w - font.width(label)) / 2, y + (h - font.lineHeight) / 2 + 1, th.text);
        hits.add(new Hit(x, y, w, h, action, null, null));
    }

    // ------------------------------------------------------------------ input

    @Override
    public boolean mouseClicked(MouseButtonEvent event, boolean doubleClick) {
        double mx = event.x(), my = event.y();
        int button = event.button();
        for (int i = hits.size() - 1; i >= 0; i--) {
            Hit h = hits.get(i);
            if (!h.in(mx, my)) continue;
            if (button == 0 && h.drag() != null) { dragging = h.drag(); dragging.accept(mx); return true; }
            Runnable r = button == 0 ? h.left() : button == 1 ? h.right() : null;
            if (r != null) r.run();
            return true;
        }
        if (dropdown != null) { dropdown = null; return true; }
        if (open != null) { open = null; ModuleManager.save(); return true; }
        return super.mouseClicked(event, doubleClick);
    }

    @Override
    public boolean mouseDragged(MouseButtonEvent event, double dx, double dy) {
        if (dragging != null) { dragging.accept(event.x()); return true; }
        return super.mouseDragged(event, dx, dy);
    }

    @Override
    public boolean mouseReleased(MouseButtonEvent event) {
        if (dragging != null) { dragging = null; ModuleManager.save(); return true; }
        return super.mouseReleased(event);
    }

    @Override
    public boolean mouseScrolled(double mx, double my, double sx, double sy) {
        dropdown = null;
        if (open == null) scroll = Math.max(0, Math.min(maxScroll, scroll - (int) (sy * 20)));
        else panelScroll = Math.max(0, Math.min(panelMaxScroll, panelScroll - (int) (sy * 20)));
        return true;
    }

    @Override
    public boolean keyPressed(KeyEvent event) {
        int key = event.key();
        if (key == GLFW.GLFW_KEY_ESCAPE) {
            if (dropdown != null) { dropdown = null; return true; }
            if (open != null) { open = null; ModuleManager.save(); return true; }
        }
        if (key == KeyBindingHelper.getBoundKeyOf(StarlitMod.OPEN_MENU).getValue()) { onClose(); return true; }
        return super.keyPressed(event);
    }
}
