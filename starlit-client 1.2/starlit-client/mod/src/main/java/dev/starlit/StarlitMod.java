package dev.starlit;

import com.mojang.blaze3d.platform.InputConstants;
import dev.starlit.gui.StarlitScreen;
import dev.starlit.module.ModuleManager;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientLifecycleEvents;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.resources.Identifier;
import org.lwjgl.glfw.GLFW;

public class StarlitMod implements ClientModInitializer {
    public static KeyMapping OPEN_MENU;

    @Override
    public void onInitializeClient() {
        ModuleManager.init();

        KeyMapping.Category category = KeyMapping.Category.register(Identifier.fromNamespaceAndPath("starlit", "main"));
        OPEN_MENU = KeyBindingHelper.registerKeyBinding(
            new KeyMapping("key.starlit.open_menu", InputConstants.Type.KEYSYM, GLFW.GLFW_KEY_RIGHT_SHIFT, category));

        HudRenderCallback.EVENT.register((graphics, tickCounter) -> {
            Minecraft mc = Minecraft.getInstance();
            if (mc.player == null || mc.options.hideGui) return;
            ModuleManager.renderHud(graphics, mc);
        });

        ClientLifecycleEvents.CLIENT_STOPPING.register(mc -> ModuleManager.shutdown());

        ClientTickEvents.END_CLIENT_TICK.register(mc -> {
            while (OPEN_MENU.consumeClick()) {
                if (mc.screen == null && mc.player != null) mc.setScreen(new StarlitScreen());
            }
        });
    }
}
