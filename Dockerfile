# 智联筑境 · 前期调研问卷平台（Node + Express）
FROM node:22-alpine

WORKDIR /app

# 先装依赖，利用 Docker 层缓存
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# 再拷源码与静态资源
COPY server.js ./
COPY public/ ./public/
COPY scripts/ ./scripts/
COPY data/demo-seed.json ./data/demo-seed.json

ENV NODE_ENV=production
# 端口与管理员密码请在部署平台上用真实值覆盖，切勿沿用默认密码
ENV PORT=3000
ENV ADMIN_PASSWORD=admin123456

EXPOSE 3000

CMD ["node", "server.js"]
