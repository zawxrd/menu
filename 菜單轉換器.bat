@echo off
chcp 65001 > nul
title 菜單轉 CSV 工具

echo ========================================================
echo   🍱 菜單轉 CSV 轉換工具
echo ========================================================
echo.

python menu_to_csv.py

echo.
pause
