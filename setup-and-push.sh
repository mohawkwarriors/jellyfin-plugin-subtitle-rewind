#!/bin/bash
set -e

REPO_NAME="jellyfin-plugin-subtitle-rewind"
GITHUB_USER="mohawkwarriors"

echo "=========================================================="
echo " Initializing and Pushing $REPO_NAME to GitHub"
echo "=========================================================="

git init
git add .
git commit -m "feat: initial Subtitle Rewind plugin release" || true
git branch -M main

if command -v gh &> /dev/null; then
    echo "Creating remote repository via GitHub CLI..."
    gh repo create "$GITHUB_USER/$REPO_NAME" --public --source=. --remote=origin --push || true
else
    git remote add origin "https://github.com/$GITHUB_USER/$REPO_NAME.git" || git remote set-url origin "https://github.com/$GITHUB_USER/$REPO_NAME.git"
    echo "Pushing to remote origin main..."
    git push -u origin main
fi

echo "Creating release tag v1.0.0..."
git tag -a v1.0.0 -m "Release v1.0.0" || true
git push origin v1.0.0 || true

echo "=========================================================="
echo " Successfully pushed!"
echo " GitHub Actions is now building your release."
echo " Repository manifest URL:"
echo " https://$GITHUB_USER.github.io/$REPO_NAME/manifest.json"
echo "=========================================================="
