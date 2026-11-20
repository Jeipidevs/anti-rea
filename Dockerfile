# Imagem do ANTI-REA: porteiro (proxy reverso) na porta 8080.
# Monte a configuração em /app/anti-rea.config.yml e a pasta do registro em /app/registro.

# Estágio 1: compila o TypeScript.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm ci && npm run build

# Estágio 2: só o JavaScript compilado e as dependências de produção.
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/registro && chown node:node /app/registro && chmod 700 /app/registro
USER node
EXPOSE 8080
CMD ["node", "dist/cli/index.js", "start", "--config", "/app/anti-rea.config.yml"]
