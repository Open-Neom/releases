# Open Neom — Official Multiplatform Releases & CI/CD Hub

Este repositorio público cumple dos funciones para el ecosistema **Open Neom / Cyberneom / EMXI / Gigmeout / Itzli / Blup / VRlizate**:

1. **CDN Público de Instaladores Compilados (sin código fuente):** Sirve los instaladores oficiales siempre actualizados (`.exe`, `.dmg`, `.AppImage`, `.apk`) y el manifiesto global `releases-manifest.json` sin exponer los repositorios privados de cada aplicación.
2. **Workflows Reutilizables de GitHub Actions (`.github/workflows/neom-ci-cd.yml`):** Pipeline centralizado invocado por cada aplicación al hacer `push` o *merge* de PR hacia `main`.

---

## Enlaces Directos Perpetuos (*Evergreen URLs*)

Cada vez que una aplicación publica una nueva versión en `main`, estos enlaces sirven automáticamente el binario más reciente:

| Aplicación | Windows (`.exe`) | macOS (`.dmg`) | Linux (`.AppImage`) | Android Directo (`.apk`) |
| :--- | :--- | :--- | :--- | :--- |
| **Itzli** | [Itzli-Setup-x64.exe](https://github.com/Open-Neom/releases/releases/download/itzli-latest/Itzli-Setup-x64.exe) | [Itzli-macOS.dmg](https://github.com/Open-Neom/releases/releases/download/itzli-latest/Itzli-macOS.dmg) | [Itzli-Linux-x86_64.AppImage](https://github.com/Open-Neom/releases/releases/download/itzli-latest/Itzli-Linux-x86_64.AppImage) | [Itzli-Android.apk](https://github.com/Open-Neom/releases/releases/download/itzli-latest/Itzli-Android.apk) |
| **Blup** | [Blup-Setup-x64.exe](https://github.com/Open-Neom/releases/releases/download/blup-latest/Blup-Setup-x64.exe) | [Blup-macOS.dmg](https://github.com/Open-Neom/releases/releases/download/blup-latest/Blup-macOS.dmg) | [Blup-Linux-x86_64.AppImage](https://github.com/Open-Neom/releases/releases/download/blup-latest/Blup-Linux-x86_64.AppImage) | [Blup-Android.apk](https://github.com/Open-Neom/releases/releases/download/blup-latest/Blup-Android.apk) |
| **VRlizate** | [VRlizate-Setup-x64.exe](https://github.com/Open-Neom/releases/releases/download/vrlizate-latest/VRlizate-Setup-x64.exe) | [VRlizate-macOS.dmg](https://github.com/Open-Neom/releases/releases/download/vrlizate-latest/VRlizate-macOS.dmg) | [VRlizate-Linux-x86_64.AppImage](https://github.com/Open-Neom/releases/releases/download/vrlizate-latest/VRlizate-Linux-x86_64.AppImage) | [VRlizate-Android.apk](https://github.com/Open-Neom/releases/releases/download/vrlizate-latest/VRlizate-Android.apk) |
| **EMXI** | — *(Web + Móvil)* | — *(Web + Móvil)* | — *(Web + Móvil)* | [EMXI-Android.apk](https://github.com/Open-Neom/releases/releases/download/emxi-latest/EMXI-Android.apk) |
| **Gigmeout** | — *(Web + Móvil)* | — *(Web + Móvil)* | — *(Web + Móvil)* | [Gigmeout-Android.apk](https://github.com/Open-Neom/releases/releases/download/gigmeout-latest/Gigmeout-Android.apk) |
| **Cyberneom** | — *(Web + Móvil)* | — *(Web + Móvil)* | — *(Web + Móvil)* | [Cyberneom-Android.apk](https://github.com/Open-Neom/releases/releases/download/cyberneom-latest/Cyberneom-Android.apk) |

* **Manifiesto JSON global en vivo:** `https://github.com/Open-Neom/releases/releases/download/manifest/releases-manifest.json`
