# Image of the Malas Ngoding app: one Bun process serves the API and the React app.
# It holds no secrets and no database. Pass the settings of .env when you run it.
#
#   docker build -t malas-ngoding .
#   docker run --rm -p 3000:3000 --env-file .env malas-ngoding
#
# Inside the container "localhost" is the container itself, so DATABASE_URL must point to the
# database host, for example postgres://malas:malas@host.docker.internal:5433/malas_ngoding.
FROM oven/bun:1.4.2

WORKDIR /app

# Dependencies first: this layer is reused until package.json or bun.lock change.
# --production skips devDependencies (TypeScript, Playwright, type packages) and freezes the lockfile.
COPY package.json bun.lock ./
RUN bun install --production

# bunfig.toml (the Tailwind plugin), src, db, scripts and data/seed. .dockerignore keeps out the rest.
COPY . .

ENV NODE_ENV=production
EXPOSE 3000

# The official image ships a non-root "bun" user.
USER bun

CMD ["bun", "run", "start"]
