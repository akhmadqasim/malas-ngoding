export const env = {
  mapboxToken: Bun.env.MAPBOX_TOKEN ?? "",
  anthropicApiKey: Bun.env.ANTHROPIC_API_KEY ?? "",
  databaseUrl: Bun.env.DATABASE_URL ?? "postgres://malas:malas@localhost:5433/malas_ngoding",
  port: Number(Bun.env.PORT) || 3000,
};
