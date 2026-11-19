@echo off
cd /d "%~dp0"
set CSC_IDENTITY_AUTO_DISCOVERY=false
call npm install
call npx electron-builder --win nsis portable --x64
call npx electron-packager . "LoveRussian OPS" --platform=darwin --arch=x64,arm64 --out=dist/mac-pack --overwrite --asar --ignore="(dist|node_modules/\.cache|config\.json|\.git)" --extra-resource=config.example.json --extra-resource=README-INSTALL.txt
pushd "dist\mac-pack\LoveRussian OPS-darwin-arm64" && tar -a -cf "..\..\LoveRussian-OPS-1.3.0-mac-arm64.zip" "LoveRussian OPS.app" && popd
pushd "dist\mac-pack\LoveRussian OPS-darwin-x64" && tar -a -cf "..\..\LoveRussian-OPS-1.3.0-mac-x64.zip" "LoveRussian OPS.app" && popd
copy /Y README-INSTALL.txt dist\README-INSTALL.txt >nul
echo.
echo DONE — see dist\
dir /b dist\*.exe dist\*.zip
