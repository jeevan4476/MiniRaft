FROM oven/bun:latest

WORKDIR /app

COPY package.json bun.lock* package-lock.json* ./

RUN bun install

COPY . .

EXPOSE 3000

CMD ["bun", "run", "next", "dev", "--turbopack"]
