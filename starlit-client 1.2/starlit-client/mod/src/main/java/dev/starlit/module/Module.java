package dev.starlit.module;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;

import java.util.ArrayList;
import java.util.List;

public class Module {
    public final String id;
    public final String name;
    public final String description;
    public final Category category;
    public final List<Setting> settings = new ArrayList<>();
    public boolean enabled;

    public Module(String id, String name, String description, Category category) {
        this.id = id;
        this.name = name;
        this.description = description;
        this.category = category;
    }

    protected Setting add(Setting s) {
        settings.add(s);
        return s;
    }

    public Setting get(String key) {
        for (Setting s : settings) if (s.key.equals(key)) return s;
        throw new IllegalArgumentException(key);
    }

    /** Switches the module and runs its start/stop hook, so a disabled module holds no resources. */
    public final void setEnabled(boolean on) {
        if (on == enabled) return;
        enabled = on;
        if (on) onEnable(); else onDisable();
    }

    protected void onEnable() {}
    protected void onDisable() {}

    /** Called every frame while the module is enabled and no menu hides the HUD. */
    public void renderHud(GuiGraphics g, Minecraft mc) {}

    public void resetToDefaults(Module fresh) {
        setEnabled(fresh.enabled);
        for (int i = 0; i < settings.size(); i++) {
            Setting a = settings.get(i), b = fresh.settings.get(i);
            a.bool = b.bool; a.num = b.num; a.color = b.color;
        }
    }
}
