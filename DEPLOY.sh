#!/bin/bash
# Run this if git is locked
rm -f .git/index.lock
git add src/connectors/whatsapp.js src/index.js web/package-lock.json web/package.json web/src/App.css web/src/App.jsx web/dist/
git commit -m "feat: Full WA sync v3 - media, photos, history"
git push origin main
