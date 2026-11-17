#!/usr/bin/env bash
# Описание релиза для GitHub: раздел «## X.Y.Z» из CHANGELOG.md и
# подсказка, какой файл скачать. Зовётся из .github/workflows/build.yml;
# первый аргумент — версия (с «v» или без), второй — куда записать.
set -euo pipefail
version="${1#v}"
out="$2"

# sub(\r) — на Windows-сборщике checkout отдаёт файлы с CRLF.
awk -v v="$version" '
  { sub(/\r$/, "") }
  $0 == "## " v { found = 1; next }
  /^## / { if (found) exit }
  found { print }
' CHANGELOG.md > "$out"

if ! grep -q '[^[:space:]]' "$out"; then
  echo "Изменения этой версии не описаны в CHANGELOG.md." > "$out"
fi

cat >> "$out" <<'EOF'

---

**Какой файл скачать**
- Windows 10 и 11 – `Fictaris-Setup-…exe`
- Mac с Apple Silicon (M1 и новее) – `…-arm64.dmg`, Mac с Intel – `…-x64.dmg`
- Linux – `…AppImage`
- Android 7 и новее – `Fictaris-…apk`

Файлы `.blockmap` и `latest*.yml` нужны для автообновления, скачивать их не надо. Приложение не подписано сертификатом разработчика – как пройти предупреждение системы при установке, написано в [README](https://github.com/DeQerrti/Fictaris-app#установка) ([English](https://github.com/DeQerrti/Fictaris-app/blob/main/README.en.md#installation)).
EOF
