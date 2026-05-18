const requiredServerEnvKeys = ["BETTER_AUTH_SECRET", "DATABASE_URL", "WEATHER_API_KEY"] as const;

function getRequiredEnvValue(key: string): string {
    const value = process.env[key];

    if (!value) {
        throw new Error(`Missing required environment variables: ${key}`);
    }
    
    return value;
}

export const env = {
    nodeEnv: process.env.NODE_ENV ?? "development",
    isProduction: process.env.NODE_ENV === "production",
    server: {
        betterAuthSecret: getRequiredEnvValue(requiredServerEnvKeys[0]),
        databaseUrl: getRequiredEnvValue(requiredServerEnvKeys[1]),
        weatherApiKey: getRequiredEnvValue(requiredServerEnvKeys[2]),
    },
} as const;

export type AppEnv = typeof env;