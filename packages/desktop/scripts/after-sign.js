const path = require("node:path");

const { smokePackagedDesktopApp } = require("../e2e/packaged-app-smoke.js");

const EXECUTABLE_NAME = "Paseo";

// electron-builder arch enum → Node.js arch string (mirrors after-pack.js)
const ARCH_MAP = { 0: "ia32", 1: "x64", 2: "armv7l", 3: "arm64", 4: "universal" };

exports.default = async function afterSign(context) {
  if (process.env.PASEO_DESKTOP_SMOKE !== "1") {
    return;
  }

  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const arch = ARCH_MAP[context.arch] || process.arch;
  if (arch !== process.arch) {
    // Cross-built binaries run under Rosetta on this runner; the packaged-app
    // smoke is only meaningful on a native host (same policy as after-pack).
    console.log(
      `Skipping packaged-app smoke: build arch ${arch} differs from host ${process.arch}.`,
    );
    return;
  }

  await smokePackagedDesktopApp({
    appPath: path.join(context.appOutDir, `${EXECUTABLE_NAME}.app`),
  });
};
