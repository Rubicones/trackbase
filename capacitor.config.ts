import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
    appId: "com.trackbase.app",
    appName: "trackbase",
    webDir: "public",
    server: {
        url: "https://trackbase-sigma.vercel.app",
        cleartext: false,
    },
};

export default config;
