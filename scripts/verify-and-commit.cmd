@echo off
rem Local helper: build the extension, lint, format-check, then commit with the given message.
rem Usage: scripts\verify-and-commit.cmd "commit message"   (writes progress to verify.log)
cd /d "%~dp0.."
set LOG=verify.log
echo start > %LOG%
node node_modules\vite\bin\vite.js build extension >> %LOG% 2>&1 || (echo EXT_BUILD_FAIL >> %LOG% & exit /b 1)
node node_modules\vite\bin\vite.js build extension -c extension\vite.content.config.ts >> %LOG% 2>&1 || (echo CONTENT_BUILD_FAIL >> %LOG% & exit /b 1)
node node_modules\vitest\vitest.mjs run --no-color >> %LOG% 2>&1 || (echo TEST_FAIL >> %LOG% & exit /b 1)
node node_modules\eslint\bin\eslint.js . >> %LOG% 2>&1 || (echo LINT_FAIL >> %LOG% & exit /b 1)
node node_modules\prettier\bin\prettier.cjs --check . >> %LOG% 2>&1 || (echo FORMAT_FAIL >> %LOG% & exit /b 1)
if "%~1"=="" (echo VERIFIED_NO_COMMIT >> %LOG% & exit /b 0)
git add -A >> %LOG% 2>&1
git reset -q -- verify.log
git diff --cached --quiet && (echo NOTHING_TO_COMMIT >> %LOG% & git log --oneline -n 1 >> %LOG% & echo ALL_OK >> %LOG% & exit /b 0)
git commit -m "%~1" >> %LOG% 2>&1 || (echo COMMIT_FAIL >> %LOG% & exit /b 1)
git log --oneline -n 1 >> %LOG% 2>&1
echo ALL_OK >> %LOG%
