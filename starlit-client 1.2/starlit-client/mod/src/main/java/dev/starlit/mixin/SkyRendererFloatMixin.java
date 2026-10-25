package dev.starlit.mixin;

import dev.starlit.sky.SkyHooks;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Pseudo;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyVariable;

/** Variant B: SkyRenderer.renderSkyDisc(float r, float g, float b). Only applied with -Dstarlit.skyhooks=b. */
@Pseudo
@Mixin(targets = "net.minecraft.client.renderer.SkyRenderer")
public abstract class SkyRendererFloatMixin {
    @ModifyVariable(method = "renderSkyDisc", at = @At("HEAD"), argsOnly = true, ordinal = 0, require = 0)
    private float starlit$r(float v) { return SkyHooks.tintChannel(0, v); }

    @ModifyVariable(method = "renderSkyDisc", at = @At("HEAD"), argsOnly = true, ordinal = 1, require = 0)
    private float starlit$g(float v) { return SkyHooks.tintChannel(1, v); }

    @ModifyVariable(method = "renderSkyDisc", at = @At("HEAD"), argsOnly = true, ordinal = 2, require = 0)
    private float starlit$b(float v) { return SkyHooks.tintChannel(2, v); }
}
