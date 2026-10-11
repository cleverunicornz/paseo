const pkg = require("./package.json");
const appVariant = process.env.APP_VARIANT ?? "production";

const variants = {
  production: { name: "Paseo", packageId: "sh.paseo" },
  development: { name: "Paseo Debug", packageId: "sh.paseo.debug" },
};

const variant = variants[appVariant] ?? variants.production;

export default {
  expo: {
    name: variant.name,
    slug: "voice-mobile",
    version: pkg.version,
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "paseo",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    web: {
      output: "single",
      favicon: "./assets/images/favicon.png",
    },
    autolinking: {
      searchPaths: ["../../node_modules", "./node_modules"],
    },
    plugins: ["expo-router"],
    experiments: {
      ...(process.env.PASEO_WEB_BASE_URL ? { baseUrl: process.env.PASEO_WEB_BASE_URL } : {}),
      typedRoutes: true,
      reactCompiler: true,
      autolinkingModuleResolution: true,
    },
    extra: {
      router: {},
      eas: {
        projectId: "0e7f65ce-0367-46c8-a238-2b65963d235a",
      },
    },
    owner: "getpaseo",
  },
};
