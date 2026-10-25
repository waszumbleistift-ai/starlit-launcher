'use strict';
const DEFAULTS = {
  versionManifest: 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
  runtimeIndex: 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json',
  assetsBase: 'https://resources.download.minecraft.net',
  librariesBase: 'https://libraries.minecraft.net/',
  fabricMeta: 'https://meta.fabricmc.net',
  modrinth: 'https://api.modrinth.com',
  msDevice: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode',
  msToken: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
  xblAuth: 'https://user.auth.xboxlive.com/user/authenticate',
  xstsAuth: 'https://xsts.auth.xboxlive.com/xsts/authorize',
  mcLogin: 'https://api.minecraftservices.com/authentication/login_with_xbox',
  mcEntitlements: 'https://api.minecraftservices.com/entitlements/mcstore',
  mcProfile: 'https://api.minecraftservices.com/minecraft/profile',
};
const createEndpoints = (overrides = {}) => ({ ...DEFAULTS, ...overrides });
module.exports = { createEndpoints, DEFAULTS };
