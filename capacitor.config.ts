import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
    appId: "com.trackbase.app",
    appName: "trackbase",
    webDir: "public",
    server: {
        url: "https://trackbase-git-capacitor-rubicons-projects.vercel.app",
        cleartext: false,
    },
};

export default config;
