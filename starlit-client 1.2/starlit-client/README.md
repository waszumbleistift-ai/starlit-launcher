# Starlit Client

Two parts in one folder:

| Folder | What it is |
|---|---|
| `mod/` | The **Starlit** Fabric mod (Gradle project, Minecraft 1.21.11) |
| `launcher/` | The **Starlit Launcher** (Electron, no runtime dependencies) |

The launcher installs and starts Minecraft **1.14 – 1.21.11**, installs Fabric, signs you in with Microsoft,
manages Fabric mods per version and loads the matching Starlit build.

## Quick start (Windows)

1. Install Node.js 20+ and a JDK 21 (only needed to build the mod).
2. Build the mod: `cd mod && gradle build` -> `mod/build/libs/starlit-0.1.0.jar`
3. Start the launcher:
   ```
   cd launcher
   npm install
   node scripts/add-starlit-build.js ..\mod\build\libs\starlit-0.1.0.jar
   npm start
   ```
4. Settings -> *Azure client ID* (see below), Account -> *Sign in*, pick a version, **Play**.

Optional installer: `npm run dist` (electron-builder, needs internet).

## Microsoft login

The login uses the official OAuth *device code* flow (Microsoft -> Xbox Live -> XSTS -> Minecraft services).
You approve on microsoft.com in your browser; the launcher never sees your password. Tokens are stored encrypted with
Electron `safeStorage` (Windows DPAPI).

Microsoft requires an application registration, and Mojang has to approve it for the Minecraft API. You must do this yourself:

1. https://portal.azure.com -> *Microsoft Entra ID* -> *App registrations* -> *New registration*.
   Supported account types: *Personal Microsoft accounts only*.
2. Under *Authentication* enable *Allow public client flows*.
3. Copy the *Application (client) ID* into the launcher (Settings -> Account setup).
4. Request Minecraft API access for the app via Mojang's form (see the "Microsoft authentication" page on the Minecraft Wiki).
   Until it is approved, the Minecraft step answers with an error even though Microsoft sign-in works.

## How versions and mods work

* **Versions:** the list comes from Mojang's official manifest, filtered to releases 1.14 – 1.21.11. Fabric does not exist
  before 1.14, so older versions are not offered.
* **Java:** the launcher downloads the exact Mojang runtime the version asks for (Java 8/16/17/21). A custom Java path can be set.
* **Files** (`%APPDATA%\starlit-launcher\data`): `versions/`, `libraries/`, `assets/`, `runtime/` are shared; each Minecraft version
  has its own `instances/<version>/` with its own `mods/` folder. Downloads are written to `.part` files, checked by SHA-1/SHA-512
  and size, and skipped when already valid.
* **Fabric loader** comes from meta.fabricmc.net, **Fabric API** from Modrinth (hash-verified). Nothing else is downloaded from third parties.
* **Starlit builds:** `launcher/starlit-mods/registry.json` lists jars. The supported Minecraft range is read from each jar's own
  `fabric.mod.json`, so a jar can never be loaded for a version it does not declare. Add one with `npm run add-starlit -- <jar>`.
  If no build matches, the game still starts (with Fabric) and the launcher says so.
* **User mods:** *Add mods...* imports `.jar` files for the selected version. Non-Fabric jars and jars whose `depends.minecraft`
  excludes the version are refused; missing dependencies are shown as warnings. A wrong-version jar that ends up in the folder
  anyway is renamed to `.jar.disabled` before every start.

## Tests - what was and was not verified

Run `cd launcher && npm test`.

Verified automatically (11 tests, against a local fake of the Mojang/Fabric/Modrinth/Microsoft/Xbox/Minecraft servers and a fake `java`):
version filtering, download + hash verification and skipping, library OS rules, old-style natives extraction, Fabric profile merging,
launch command (main class, classpath, tokens, log config), no re-download on second start, offline start from cache, device-code login
flow, missing licence / missing client ID errors, Starlit selection per version, mod import / enable / disable / remove /
incompatible handling, path traversal protection.
The UI was rendered in Chromium (with the WebGL shader) at several window sizes and checked for layout, overflow and HTML injection.

**Not verified** (no access to the real services or a GPU/Windows machine in the build environment):
* real downloads from Mojang, Fabric and Modrinth, and a real Minecraft start
* a real Microsoft/Minecraft login (needs your Azure app + Mojang approval)
* the Electron shell itself (`npm start`), the installer, Windows DPAPI storage
* **Minecraft versions:** none has been launched. 1.14 – 1.16 use Java 8 and the old natives format, 1.17 – 1.20.4 Java 16/17, 1.20.5+ Java 21;
  the code handles all of these paths but only 1.21.11 is the intended target.
* **The Starlit mod** has not been compiled by its author's tooling in the build environment. It targets 1.21.11 only;
  other versions need their own port (Minecraft changed its GUI and input APIs several times). Until a jar for a version
  is registered, that version runs without Starlit.

## Known limitations

* UI language is English.
* Pre-1.14 versions are not supported (no Fabric).
* The Aurora background needs WebGL; without it a CSS gradient is used.

---

## Neu: Design-Angleichung, Sky, LyricSky, Appearance

### Shared Theme (Launcher ⇄ Mod)
Der Launcher schreibt das aufgelöste Theme nach `<Datenordner>/shared/theme.json` und startet Minecraft mit
`-Dstarlit.theme=<Pfad>`. Der Mod liest die Datei und prüft sie höchstens einmal pro Sekunde auf Änderungen,
Farbänderungen im Launcher erscheinen also live im Mod-GUI. Fehlt die Datei oder ist sie defekt, nutzt der Mod das Aurora-Preset.
Launcher-Seite **Appearance**: Presets (Midnight, Aurora, Crimson, Emerald, Custom), Farbwähler + HEX, Live-Vorschau,
Zurücksetzen, Themes speichern/laden/löschen, Intensität von Akzenten und Effekten.

### Module
- **Sky** (Visual): Himmelsfarbe über Presets, Farben, Verlauf, Intensität; wird beim Ausschalten vollständig zurückgesetzt.
- **LyricSky** (HUD): schwebende, synchronisierte Lyrics zum aktuellen Titel. Quelle: Windows-Mediensitzung (SMTC, PowerShell) oder
  manuell; Lyrics von LRCLIB (`lrclib.net`), Cache lokal, eigene `.lrc`-Dateien als Fallback (Ordner per Button).
  Netzwerk und Prozessaufrufe laufen nie im Render-Thread. Statusmeldungen bei „keine Wiedergabe“ / „nicht gefunden“ / „offline“.
- Alle bisherigen Module und die Config-Persistenz bleiben erhalten.

### Sky-Hook (experimentell)
Sky färbt nur die Himmelskuppel über einen optionalen Mixin. Der Hook ist standardmäßig **aus**
(Launcher → Settings → „Sky renderer hook“: Off / A / B). Ob A oder B für 1.21.11 passt, ist **nicht geprüft**. Ohne Hook zeigt das Modul das an.
Sodium/Iris: nicht getestet; der Mixin ist `@Pseudo` und `require=0`, schlägt also still fehl statt abzustürzen.

### Was geprüft wurde – und was nicht
| Teil | Status |
|---|---|
| Launcher-Kernlogik (Download, Hash, Profile, Fabric, Themes, Startargumente, skyHooks) | `npm test`: 16/16, offline mit Fake-Servern und Fake-Java |
| Launcher-UI | in Chromium mit Mock-API gerendert (inkl. WebGL-Shader, Themes, schmale Fenster) |
| Mod-Kernlogik (`dev.starlit.core`: JSON, Farben, Theme, LRC, Sync, SMTC-Parser, Cache, Sky-Mathe) | `sh mod/tests/run.sh <theme.json>`: 89/89 |
| Mod-Code mit Minecraft-Bezug (GUI, Module, Mixins) | nur gegen **selbstgeschriebene API-Stubs** kompiliert, **nie** gegen echtes Minecraft 1.21.11 gebaut oder gestartet |
| PowerShell-SMTC-Abfrage | Parser getestet, Skript selbst **nicht** auf Windows ausgeführt |
| Microsoft-Login | Code vorhanden, echter Login nicht möglich zu testen; die Azure-App braucht Mojangs Freigabe (aka.ms/mce-reviewappid) |
| Minecraft tatsächlich gestartet | **nein**, nie |

### Bekannte Grenzen
- Sky hat keinen Aurora-Shader und keine Wolken; nur die Himmelsfarbe.
- LyricSky zeichnet im Bildschirmraum, nicht als 3D-Objekt in der Welt.
- Mod-Build nur für Minecraft 1.21.11; für ältere Versionen gibt es keinen Mod (der Launcher startet sie trotzdem mit Fabric ohne Starlit).
- Das GUI nutzt die Minecraft-Schrift, nicht die des Launchers.

### Bauen
```
cd mod && gradle build          # erzeugt build/libs/starlit-0.1.0.jar
cd ../launcher && npm install
node scripts/add-starlit-build.js ..\mod\build\libs\starlit-0.1.0.jar
npm start
```
Tests: `npm test` (Launcher), `sh mod/tests/run.sh <theme.json>` bzw. `mod\tests\run.ps1`.
